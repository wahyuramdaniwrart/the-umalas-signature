#include "RcSwitchReceiver.hpp"
#include <Arduino.h>
#include <Preferences.h>
#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include "driver/pcnt.h" 
#include "soc/rtc_cntl_reg.h"

// --- ISI IDENTITAS MODUL ---
#define MODUL_TYPE 'A'           // UBAH KE 'A', 'B', atau 'C'
const char* MY_ROOM_ID = "D112"; 

// --- ISI MAC ADDRESS MASTER DI SINI ---
uint8_t masterMac[6] = {0xB0,0xA7,0x32,0x34,0x39,0x8C}; // Ganti ke MAC Master Anda
bool hasMaster = true; // Langsung true karena sudah di-hardcode

#define PMK_KEY "MasterKeyRumah10" 
#define LMK_KEY "LocalKeyRelay001"
#define RX433_DATA_PIN 25
#define PAIR_BUTTON_PIN 0  
#define STATUS_LED_PIN 14  

const int relayPins[] = {4,12,17,27, 32, 33}; //modul A
//const int relayPins[] = {5, 4 ,12 , 27 , 32 , 33}; //modul B dan C
const int numRelays = sizeof(relayPins) / sizeof(relayPins[0]);

typedef struct {
    char roomID[10];
    uint8_t channel;
    uint8_t state;
} Payload;

Payload feedbackData;
uint32_t savedIDs[numRelays + 1]; 
uint32_t masterID = 0;
bool isPairingMode = false;
int pairingTarget = -1; 
uint32_t pairingTimeout = 0;

Preferences prefs;
static RcSwitchReceiver<RX433_DATA_PIN> rcSwitchReceiver;

DATA_ISR_ATTR static const RxProtocolTable <
    makeTimingSpec< 1, 33, 20,   1,   31,    1,  3,    3,  1, false>,
    makeTimingSpec< 2, 350, 20,   1,   31,    1,  3,    3,  1, false>,
    makeTimingSpec< 3, 33, 20,   1,   10,    1,  3,    3,  1, false>, 
    makeTimingSpec< 4, 33, 20,  30,   71,    4, 11,    9,  6, false>
> rxProtocolTable;

void sendFeedback(int channel, bool isRelayOff) {
    if (!hasMaster) return;
    strncpy(feedbackData.roomID, MY_ROOM_ID, sizeof(feedbackData.roomID));
    feedbackData.channel = (uint8_t)channel + 1;
    feedbackData.state = isRelayOff ? 1 : 0;     
    esp_now_send(masterMac, (uint8_t *) &feedbackData, sizeof(Payload));
}

void registerMaster(const uint8_t* mac) {
    esp_now_peer_info_t peerInfo = {};
    memcpy(peerInfo.peer_addr, mac, 6);
    peerInfo.channel = 0;
    peerInfo.encrypt = true;
    for (int i = 0; i < 16; i++) peerInfo.lmk[i] = LMK_KEY[i];

    if (esp_now_is_peer_exist(mac)) esp_now_del_peer(mac);
    esp_now_add_peer(&peerInfo);
}

void OnDataRecv(const uint8_t * mac, const uint8_t *data, int len) {
    if (len == sizeof(Payload)) {
        Payload* p = (Payload*)data;
        if (strcmp(p->roomID, MY_ROOM_ID) == 0) {
            // FITUR HAPUS MEMORI RF
            if (p->state == 0xFD) {
                prefs.begin("relay_sys", false);
                for (int i = 0; i < numRelays; i++) {
                    char key[10]; sprintf(key, "id%d", i);
                    prefs.remove(key); // Hapus ID per channel
                    savedIDs[i] = 0;
                }
                prefs.remove("idM"); // Hapus ID Master (Grup)
                masterID = 0;
                prefs.end();
                
                // Indikasi LED menyala lama sebagai tanda reset berhasil
                digitalWrite(STATUS_LED_PIN, HIGH);
                delay(2000);
                digitalWrite(STATUS_LED_PIN, LOW);
                return;
            }
            
            int idx = p->channel - 1;
            if (idx >= 0 && idx < numRelays) {
                if (p->state == 0xFE) {
                    pairingTarget = idx;
                    isPairingMode = true;
                    pairingTimeout = millis() + 15000;
                } else {
                    digitalWrite(relayPins[idx], p->state); 
                    prefs.begin("relay_sys", false);
                    char sKey[10]; sprintf(sKey, "st%d", idx);
                    prefs.putBool(sKey, (p->state == 0)); 
                    prefs.end();
                }
            }
        }
    }
}

void setAllRelays(bool targetOn) {
    for(int i=0; i<numRelays; i++) {
        uint8_t val = targetOn ? 0 : 1;
        digitalWrite(relayPins[i], val);
        prefs.begin("relay_sys", false);
        char sKey[10]; sprintf(sKey, "st%d", i);
        prefs.putBool(sKey, targetOn);
        prefs.end();
        sendFeedback(i, !targetOn); 
    }
}

void loadSytemState() {
    prefs.begin("relay_sys", true);
    for (int i = 0; i < numRelays; i++) {
        char key[10], sKey[10];
        sprintf(key, "id%d", i); 
        sprintf(sKey, "st%d", i);
        savedIDs[i] = prefs.getUInt(key, 0);
        bool lastOn = prefs.getBool(sKey, false);
        digitalWrite(relayPins[i], lastOn ? 0 : 1);
    }
    masterID = prefs.getUInt("idM", 0);
    prefs.end();
}

void saveID(int index, uint32_t id) {
    prefs.begin("relay_sys", false);
    if(index < numRelays) {
        char key[10]; sprintf(key, "id%d", index);
        prefs.putUInt(key, id);
        savedIDs[index] = id;
    } else {
        prefs.putUInt("idM", id);
        masterID = id;
    }
    prefs.end();
    digitalWrite(STATUS_LED_PIN, HIGH);
    vTaskDelay(pdMS_TO_TICKS(1000));
    digitalWrite(STATUS_LED_PIN, LOW);
}

void RF_Core0_Task(void * pvParameters) {
    rcSwitchReceiver.begin(rxProtocolTable.toTimingSpecTable());
    for(;;) {
        if (isPairingMode) {
            digitalWrite(STATUS_LED_PIN, (millis() / 150) % 2); 
            if (millis() > pairingTimeout) {
                isPairingMode = false;
                digitalWrite(STATUS_LED_PIN, LOW);
            }
        }
        if (rcSwitchReceiver.available()) {
            uint32_t val = rcSwitchReceiver.receivedValue();
            if (isPairingMode) {
                saveID(pairingTarget, val);
                isPairingMode = false;
            } else {
                if (val != 0 && val == masterID) {
                    bool anyOn = false;
                    for(int i=0; i<numRelays; i++) if(digitalRead(relayPins[i]) == LOW) anyOn = true;
                    setAllRelays(!anyOn);
                } 
                else {
                    for (int i = 0; i < numRelays; i++) {
                        if (val != 0 && val == savedIDs[i]) {
                            uint8_t current = digitalRead(relayPins[i]);
                            uint8_t next = (current == LOW) ? HIGH : LOW;
                            digitalWrite(relayPins[i], next);
                            prefs.begin("relay_sys", false);
                            char sKey[10]; sprintf(sKey, "st%d", i);
                            prefs.putBool(sKey, (next == LOW));
                            prefs.end();
                            sendFeedback(i, (next == HIGH)); 
                            break;
                        }
                    }
                }
            }
            rcSwitchReceiver.resetAvailable();
        }
        vTaskDelay(pdMS_TO_TICKS(1)); 
    }
}

void setup() {
    WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0);
    Serial.begin(115200); 
    pinMode(STATUS_LED_PIN, OUTPUT);
    for (int i = 0; i < numRelays; i++) {
        pinMode(relayPins[i], OUTPUT);
        digitalWrite(relayPins[i], HIGH); 
    }
    loadSytemState();
    WiFi.mode(WIFI_STA);
    if (esp_now_init() == ESP_OK) {
        esp_now_set_pmk((uint8_t *)PMK_KEY);
        esp_now_register_recv_cb(OnDataRecv);
        // Langsung daftarkan master karena sudah hardcode
        registerMaster(masterMac);
    }
    xTaskCreatePinnedToCore(RF_Core0_Task, "RF_Task", 4096, NULL, 5, NULL, 0);
}

void loop() { vTaskDelay(pdMS_TO_TICKS(1000)); }
