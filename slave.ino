#include "RcSwitchReceiver.hpp"
#include <Arduino.h>
#include <Preferences.h>
#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include "driver/pcnt.h" 
#include "soc/rtc_cntl_reg.h"

// --- KONFIGURASI IDENTITAS MODUL ---
#define MODUL_TYPE 'A'           // Ubah ke 'B' atau 'C' untuk modul lain
const uint8_t MY_ROOM_ID = 101;  // Harus sama dengan Master

// --- KONFIGURASI KEAMANAN (WAJIB SAMA DENGAN MASTER) ---
#define PMK_KEY "MasterKeyRumah01" 
#define LMK_KEY "LocalKeyRelay_01"

// --- KONFIGURASI PIN ---
#define RX433_DATA_PIN 25
#define PAIR_BUTTON_PIN 0  
#define STATUS_LED_PIN 14  

const int relayPins[] = {4, 27, 32, 33, 12, 17}; 
const int numRelays = sizeof(relayPins) / sizeof(relayPins[0]);

// --- STRUKTUR DATA ESP-NOW ---
typedef struct {
    uint8_t roomID;
    uint8_t channel;
    uint8_t state; // 0=ON, 1=OFF (Sesuai Active Low)
} Payload;

Payload feedbackData;
uint8_t masterMac[6] = {0};
bool hasMaster = false;

// Variabel Kontrol
uint32_t savedIDs[numRelays + 1]; 
uint32_t masterID = 0;
bool isPairingMode = false;
int pairingTarget = -1; 
uint32_t pairingTimeout = 0;

Preferences prefs;
static RcSwitchReceiver<RX433_DATA_PIN> rcSwitchReceiver;

// --- DEFINISI PROTOKOL RF ---
DATA_ISR_ATTR static const RxProtocolTable <
    makeTimingSpec< 1, 33, 20,   1,   31,    1,  3,    3,  1, false>,
    makeTimingSpec< 2, 350, 20,   1,   31,    1,  3,    3,  1, false>,
    makeTimingSpec< 3, 33, 20,   1,   10,    1,  3,    3,  1, false>, 
    makeTimingSpec< 4, 33, 20,  30,   71,    4, 11,    9,  6, false>
> rxProtocolTable;

// --- FUNGSI ESP-NOW ---

void sendFeedback(int channel, bool isRelayOff) {
    if (!hasMaster) return;
    feedbackData.roomID = MY_ROOM_ID;
    feedbackData.channel = (uint8_t)channel + 1; // Index 1-6
    feedbackData.state = isRelayOff ? 1 : 0;     // Kirim 0 jika relay ON (LOW)
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
    
    memcpy(masterMac, mac, 6);
    hasMaster = true;
    
    prefs.begin("relay_sys", false);
    prefs.putBytes("mMac", masterMac, 6);
    prefs.end();
}

void OnDataRecv(const uint8_t * mac, const uint8_t *data, int len) {
    // 1. Respon terhadap scan Pairing Master ("WHOIS")
    if (len == 5 && memcmp(data, "WHOIS", 5) == 0) {
        uint8_t reply[6] = {'H', 'E', 'L', 'L', 'O', MODUL_TYPE};
        esp_now_peer_info_t bcastPeer = {};
        uint8_t bcastAddr[] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};
        memcpy(bcastPeer.peer_addr, bcastAddr, 6);
        if (!esp_now_is_peer_exist(bcastAddr)) esp_now_add_peer(&bcastPeer);
        
        esp_now_send(bcastAddr, reply, 6);
        registerMaster(mac); 
        return;
    }

    // 2. Kontrol Relay dari Master
    if (len == sizeof(Payload)) {
        Payload* p = (Payload*)data;
        if (p->roomID == MY_ROOM_ID) {
            int idx = p->channel - 1;
            if (idx >= 0 && idx < numRelays) {
                if (p->state == 0xFE || p->state == 0xFD) {
                    pairingTarget = idx;
                    isPairingMode = true;
                    pairingTimeout = millis() + 15000;
                } else {
                    // Logika Active Low: 0 dari Master -> digitalWrite LOW (Relay ON)
                    digitalWrite(relayPins[idx], p->state); 
                    
                    prefs.begin("relay_sys", false);
                    char sKey[10]; sprintf(sKey, "st%d", idx);
                    prefs.putBool(sKey, (p->state == 0)); // Simpan true jika relay ON
                    prefs.end();
                }
            }
        }
    }
}

// --- FUNGSI RELAY & RF ---

void setAllRelays(bool targetOn) {
    for(int i=0; i<numRelays; i++) {
        // Jika target ON -> tulis LOW (0), jika target OFF -> tulis HIGH (1)
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
        
        // Load status terakhir. Jika tersimpan TRUE (ON), maka beri LOW
        bool lastOn = prefs.getBool(sKey, false);
        digitalWrite(relayPins[i], lastOn ? 0 : 1);
    }
    masterID = prefs.getUInt("idM", 0);
    if (prefs.getBytesLength("mMac") == 6) {
        prefs.getBytes("mMac", masterMac, 6);
        hasMaster = true;
    }
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

// --- TASK RF & BUTTON ---

void handleButton() {
    static uint32_t pressStartTime = 0;
    static int clickCount = 0;
    static uint32_t lastClickTime = 0;
    bool isPressed = (digitalRead(PAIR_BUTTON_PIN) == LOW);

    if (isPressed) {
        if (pressStartTime == 0) pressStartTime = millis();
        uint32_t duration = millis() - pressStartTime;
        if (duration > 10000) digitalWrite(STATUS_LED_PIN, (millis()/50)%2); 
        else if (duration > 5000) digitalWrite(STATUS_LED_PIN, HIGH); 
    } 
    else if (pressStartTime != 0) {
        uint32_t duration = millis() - pressStartTime;
        pressStartTime = 0;
        digitalWrite(STATUS_LED_PIN, LOW);

        if (duration >= 10000) {
            prefs.begin("relay_sys", false);
            prefs.clear();
            prefs.end();
            ESP.restart(); 
        } 
        else if (duration >= 5000) {
            pairingTarget = 6;
            isPairingMode = true;
            pairingTimeout = millis() + 15000;
        } 
        else if (duration > 50) {
            clickCount++;
            lastClickTime = millis();
        }
    }

    if (clickCount > 0 && millis() - lastClickTime > 500) {
        if (clickCount <= numRelays) {
            pairingTarget = clickCount - 1;
            isPairingMode = true;
            pairingTimeout = millis() + 15000;
        }
        clickCount = 0;
    }
}

void RF_Core0_Task(void * pvParameters) {
    rcSwitchReceiver.begin(rxProtocolTable.toTimingSpecTable());

    for(;;) {
        handleButton();

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
                    for(int i=0; i<numRelays; i++) {
                        if(digitalRead(relayPins[i]) == LOW) anyOn = true;
                    }
                    setAllRelays(!anyOn);
                } 
                else {
                    for (int i = 0; i < numRelays; i++) {
                        if (val != 0 && val == savedIDs[i]) {
                            // Toggle state: Jika LOW (0), ganti HIGH (1)
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
    
    pinMode(PAIR_BUTTON_PIN, INPUT_PULLUP);
    pinMode(STATUS_LED_PIN, OUTPUT);
    for (int i = 0; i < numRelays; i++) {
        pinMode(relayPins[i], OUTPUT);
        digitalWrite(relayPins[i], HIGH); // Default OFF (High)
    }
    
    loadSytemState();

    WiFi.mode(WIFI_STA);
    if (esp_now_init() == ESP_OK) {
        esp_now_set_pmk((uint8_t *)PMK_KEY);
        esp_now_register_recv_cb(OnDataRecv);
        if (hasMaster) registerMaster(masterMac);
    }

    pcnt_config_t pcnt_config = {};
    pcnt_config.pulse_gpio_num = RX433_DATA_PIN;
    pcnt_config.channel = PCNT_CHANNEL_0;
    pcnt_config.unit = PCNT_UNIT_0;
    pcnt_config.pos_mode = PCNT_COUNT_INC;  
    pcnt_unit_config(&pcnt_config);
    pcnt_set_filter_value(PCNT_UNIT_0, 1023);
    pcnt_filter_enable(PCNT_UNIT_0);

    xTaskCreatePinnedToCore(RF_Core0_Task, "RF_Task", 4096, NULL, 5, NULL, 0);
}

void loop() {
    vTaskDelay(pdMS_TO_TICKS(1000)); 
}
