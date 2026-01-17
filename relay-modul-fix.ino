#include "RcSwitchReceiver.hpp"
#include <Arduino.h>
#include <Preferences.h>
#include "driver/pcnt.h" 
#include "soc/rtc_cntl_reg.h"

// --- KONFIGURASI PIN ---
#define RX433_DATA_PIN 25
#define PAIR_BUTTON_PIN 0  
#define STATUS_LED_PIN 14  

const int relayPins[] = {4, 17, 32, 33, 27, 12}; 
const int numRelays = sizeof(relayPins) / sizeof(relayPins[0]);

// Variabel Kontrol
uint32_t savedIDs[numRelays + 1]; 
uint32_t masterID = 0;
bool isPairingMode = false;
int pairingTarget = -1; 
uint32_t pairingTimeout = 0;

Preferences prefs;
static RcSwitchReceiver<RX433_DATA_PIN> rcSwitchReceiver;

// --- DEFINISI PROTOKOL ---
DATA_ISR_ATTR static const RxProtocolTable <
    makeTimingSpec< 1, 33, 20,   1,   31,    1,  3,    3,  1, false>,
    makeTimingSpec< 2, 350, 20,   1,   31,    1,  3,    3,  1, false>,
    makeTimingSpec< 3, 33, 20,   1,   10,    1,  3,    3,  1, false>, 
    makeTimingSpec< 4, 33, 20,  30,   71,    4, 11,    9,  6, false>
> rxProtocolTable;

// --- FUNGSI SISTEM ---

void setAllRelays(bool state) {
    for(int i=0; i<numRelays; i++) {
        digitalWrite(relayPins[i], state);
    }
}

// Fitur Baru: Animasi Relay Bergantian
void animateRelays() {
    setAllRelays(LOW);
    vTaskDelay(pdMS_TO_TICKS(100));
    for(int i=0; i<numRelays; i++) {
        digitalWrite(relayPins[i], HIGH);
        vTaskDelay(pdMS_TO_TICKS(150));
        digitalWrite(relayPins[i], LOW);
    }
    // Kedip akhir semua relay
    setAllRelays(HIGH);
    vTaskDelay(pdMS_TO_TICKS(300));
    setAllRelays(LOW);
}

void loadSytemState() {
    prefs.begin("relay_sys", true);
    for (int i = 0; i < numRelays; i++) {
        char key[10], sKey[10];
        sprintf(key, "id%d", i); 
        sprintf(sKey, "st%d", i);
        savedIDs[i] = prefs.getUInt(key, 0);
        digitalWrite(relayPins[i], prefs.getBool(sKey, false));
    }
    masterID = prefs.getUInt("idM", 0);
    prefs.end();
}

void saveRelayState(int index, bool state) {
    prefs.begin("relay_sys", false);
    char sKey[10]; sprintf(sKey, "st%d", index);
    prefs.putBool(sKey, state);
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
    vTaskDelay(pdMS_TO_TICKS(2000));
    digitalWrite(STATUS_LED_PIN, LOW);
}

// Fitur Baru: Menghapus Semua ID Terdaftar
void clearPairedDevices() {
    Serial.println(">>> CLEARING ALL RF IDs <<<");
    prefs.begin("relay_sys", false);
    for (int i = 0; i < numRelays; i++) {
        char key[10]; sprintf(key, "id%d", i);
        prefs.putUInt(key, 0);
        savedIDs[i] = 0;
    }
    prefs.putUInt("idM", 0);
    masterID = 0;
    prefs.end();
    
    animateRelays(); // Jalankan feedback relay bergantian
}

void handleButton() {
    static uint32_t pressStartTime = 0;
    static int clickCount = 0;
    static uint32_t lastClickTime = 0;
    bool isPressed = (digitalRead(PAIR_BUTTON_PIN) == LOW);

    if (isPressed) {
        if (pressStartTime == 0) pressStartTime = millis();
        uint32_t duration = millis() - pressStartTime;
        
        // Indikator Visual LED saat ditekan
        if (duration > 10000) digitalWrite(STATUS_LED_PIN, (millis()/50)%2);      // Kedip cepat (Reset)
        else if (duration > 7000) digitalWrite(STATUS_LED_PIN, (millis()/200)%2); // Kedip sedang (Hapus Data)
        else if (duration > 5000) digitalWrite(STATUS_LED_PIN, HIGH);             // Panteng (Pair Master)
    } 
    else if (pressStartTime != 0) {
        uint32_t duration = millis() - pressStartTime;
        pressStartTime = 0;
        digitalWrite(STATUS_LED_PIN, LOW);

        if (duration >= 10000) {
            Serial.println("!!! FACTORY RESET !!!");
            prefs.begin("relay_sys", false);
            prefs.clear();
            prefs.end();
            setAllRelays(true);
            vTaskDelay(pdMS_TO_TICKS(2000));
            ESP.restart(); 
        } 
        else if (duration >= 7000) {
            clearPairedDevices(); // Eksekusi penghapusan ID
        }
        else if (duration >= 5000) {
            pairingTarget = 6;
            isPairingMode = true;
            pairingTimeout = millis() + 15000;
            Serial.println("MODE: PAIR MASTER");
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
            Serial.printf("MODE: PAIR RELAY %d\n", clickCount);
        }
        clickCount = 0;
    }
}

void setupHardwareFilter() {
    pcnt_config_t pcnt_config = {};
    pcnt_config.pulse_gpio_num = RX433_DATA_PIN;
    pcnt_config.ctrl_gpio_num = PCNT_PIN_NOT_USED;
    pcnt_config.channel = PCNT_CHANNEL_0;
    pcnt_config.unit = PCNT_UNIT_0;
    pcnt_config.pos_mode = PCNT_COUNT_INC;  
    pcnt_config.neg_mode = PCNT_COUNT_DIS;
    pcnt_config.lctrl_mode = PCNT_MODE_KEEP;
    pcnt_config.hctrl_mode = PCNT_MODE_KEEP;
    pcnt_unit_config(&pcnt_config);
    pcnt_set_filter_value(PCNT_UNIT_0, 1023);
    pcnt_filter_enable(PCNT_UNIT_0);
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
                    for(int i=0; i<numRelays; i++) if(digitalRead(relayPins[i])) anyOn = true;
                    setAllRelays(!anyOn);
                    for(int i=0; i<numRelays; i++) saveRelayState(i, !anyOn);
                } 
                else {
                    for (int i = 0; i < numRelays; i++) {
                        if (val != 0 && val == savedIDs[i]) {
                            bool newState = !digitalRead(relayPins[i]);
                            digitalWrite(relayPins[i], newState);
                            saveRelayState(i, newState);
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
    for (int i = 0; i < numRelays; i++) pinMode(relayPins[i], OUTPUT);
    
    loadSytemState();
    setupHardwareFilter();

    xTaskCreatePinnedToCore(RF_Core0_Task, "RF_Task", 4096, NULL, 5, NULL, 0);
    Serial.println("System Ready. Hold 7s to clear IDs, 10s for Factory Reset.");
}

void loop() {
    vTaskDelay(pdMS_TO_TICKS(1000)); 
}
