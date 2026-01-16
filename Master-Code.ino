#include <WiFi.h>
#include <QuickEspNow.h>
#include <Preferences.h>
#include <esp_wifi.h>

// --- STRUKTUR DATA & ALAMAT MAC ---
uint8_t macA[6], macB[6], macC[6];
uint8_t bcastMac[] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};

struct Channel {
    int id; uint8_t* mac; int rly; bool state; String obj;
};

// Mapping ID ke Object HMI Individual
Channel channels[] = {
    {8, macB, 2, false, "bt_8"}, {7, macB, 1, false, "bt_7"}, {19, macC, 1, false, "bt_19"},
    {9, macB, 3, false, "bt_9"}, {12, macB, 6, false, "bt_12"}, {10, macB, 4, false, "bt_10"},
    {11, macB, 5, false, "bt_11"}, {13, macC, 1, false, "bt_13"}, {15, macC, 3, false, "bt_15"},
    {14, macC, 2, false, "bt_14"}, {20, macC, 2, false, "bt_20"}, {1, macA, 1, false, "bt_1"},
    {2, macA, 2, false, "bt_2"}, {16, macC, 4, false, "bt_16"}, {17, macC, 5, false, "bt_17"},
    {18, macC, 6, false, "bt_18"}
};

struct Group {
    String name; int chs[5]; int count; String hmiObj;
};

Group groups[] = {
    {"Kitchen",  {7, 8, 9, 19}, 4, "btKitchen"},
    {"Living",   {10, 11, 12},  3, "btLivingroom"},
    {"Bedroom",  {13, 14, 15, 20}, 4, "btBedroom"},
    {"Bathroom", {1, 2, 16},    3, "btBathroom"},
    {"Balcony",  {17, 18},      2, "btBalcony"}
};

Preferences prefs;
String inputBuffer = "";
unsigned long lastSerialTime = 0;
bool isPairingModul = false;

typedef struct { uint8_t channel; uint8_t state; } Payload;
Payload myData;

// --- FUNGSI PENGIRIMAN SERIAL HMI ---
void updateHmi(String cmd) {
    Serial2.print(cmd);
    Serial2.write(0xff); Serial2.write(0xff); Serial2.write(0xff);
}

// --- LOGIKA SINKRONISASI TOTAL (DARI BAWAH KE ATAS) ---
void syncGlobalHmi() {
    int totalChannels = sizeof(channels) / sizeof(channels[0]);
    int totalOnGlobal = 0;

    // 1. Update status Group & Hitung Global ON
    for (auto &g : groups) {
        int onCountInGroup = 0;
        for (int i = 0; i < g.count; i++) {
            for (auto &c : channels) {
                if (c.id == g.chs[i]) {
                    if (c.state) onCountInGroup++;
                    break;
                }
            }
        }
        
        // Logika Group: Hidup jika SEMUA ON, Mati jika SEMUA OFF
        if (onCountInGroup == g.count) {
            updateHmi(g.hmiObj + ".val=1");
        } else if (onCountInGroup == 0) {
            updateHmi(g.hmiObj + ".val=0");
        }
    }

    // 2. Update Visual Individual & Hitung Total ON untuk Master
    for (auto &c : channels) {
        updateHmi(c.obj + ".val=" + String(c.state ? "1" : "0"));
        if (c.state) totalOnGlobal++;
    }

    // 3. Logika Master: Hidup jika SEMUA ON, Mati jika SEMUA OFF
    if (totalOnGlobal == totalChannels) {
        updateHmi("bt1.val=1"); // bt1 adalah master
    } else if (totalOnGlobal == 0) {
        updateHmi("bt1.val=0");
    }
}

// --- FUNGSI EKSEKUSI PER CHANNEL ---
// skipSync digunakan saat loop (Master/Group) agar tidak membanjiri buffer serial
void setChannel(int chId, bool state, bool skipSync = false) {
    for (auto &c : channels) {
        if (c.id == chId) {
            // Jika status sudah sama, abaikan (mencegah loop/spam)
            if (c.state == state) return;

            c.state = state;

            // Simpan ke Flash
            prefs.begin("states", false);
            prefs.putBool(("ch" + String(chId)).c_str(), state);
            prefs.end();

            // Kirim via ESP-NOW
            // Logika index relay disesuaikan dengan modul (1-6)
            int rIdx = (chId <= 6) ? chId : (chId <= 12 ? chId - 6 : (chId <= 18 ? chId - 12 : chId - 18));
            myData.channel = rIdx;
            myData.state = state ? 0 : 1; // Active Low: 0=ON
            quickEspNow.send(c.mac, (uint8_t*)&myData, sizeof(Payload));
            
            if (!skipSync) syncGlobalHmi();
            break;
        }
    }
}

// --- HANDLER PERINTAH DARI HMI ---
void handleCommand(int id) {
    // 0-1: MASTER ALL COMMAND
    if (id == 0 || id == 1) {
        bool target = (id == 0); 
        for (auto &c : channels) {
            setChannel(c.id, target, true); // skipSync = true
            delay(5); 
        }
        syncGlobalHmi();
    }
    // 2-11: GROUP COMMAND
    else if (id >= 2 && id <= 11) {
        int gIdx = (id - 2) / 2;
        bool target = (id % 2 == 0);
        for (int i = 0; i < groups[gIdx].count; i++) {
            setChannel(groups[gIdx].chs[i], target, true);
            delay(5);
        }
        syncGlobalHmi();
    }
    // 12-13: PAIRING MODUL
    else if (id == 12 || id == 13) {
        isPairingModul = (id == 12);
        if(isPairingModul) {
            uint8_t q[] = {'W','H','O','I','S'};
            quickEspNow.send(bcastMac, q, 5);
        }
        updateHmi("setting.tStatus.txt=\"" + String(isPairingModul ? "PAIRING..." : "READY") + "\"");
    }
    // 14-21: PAIRING RF KINETIC
    else if (id >= 14 && id <= 21) {
        int chMap[] = {7, 7, 8, 8, 9, 9, 17, 17};
        int targetCh = chMap[id-14];
        uint8_t* tMac = (targetCh <= 6) ? macA : (targetCh <= 12 ? macB : macC);
        int rIdx = (targetCh > 12 ? targetCh-12 : (targetCh > 6 ? targetCh-6 : targetCh));
        myData.channel = rIdx;
        myData.state = (id % 2 == 0 ? 0xFE : 0xFD);
        quickEspNow.send(tMac, (uint8_t*)&myData, sizeof(Payload));
    }
    // 22-53: INDIVIDUAL BUTTONS
    else if (id >= 22 && id <= 53) {
        int channelList[] = {8,7,19,9,12,10,11,13,15,14,20,1,2,16,17,18};
        int chIdx = (id - 22) / 2;
        setChannel(channelList[chIdx], (id % 2 == 0));
    }
    // 100: REFRESH
    else if (id == 100) syncGlobalHmi();
}

void onData(uint8_t* mac, uint8_t* data, uint8_t len, int rssi, bool broadcast) {
    if (isPairingModul && len == 6 && data[0] == 'H') {
        char type = (char)data[5];
        prefs.begin("mac_store", false);
        if (type == 'A') { memcpy(macA, mac, 6); prefs.putBytes("macA", macA, 6); }
        else if (type == 'B') { memcpy(macB, mac, 6); prefs.putBytes("macB", macB, 6); }
        else if (type == 'C') { memcpy(macC, mac, 6); prefs.putBytes("macC", macC, 6); }
        prefs.end();
        updateHmi("setting.tStatus.txt=\"MODUL " + String(type) + " OK\"");
    }
}

void setup() {
    Serial.begin(115200);
    Serial2.begin(9600, SERIAL_8N1, 16, 17);
    WiFi.mode(WIFI_STA);
    esp_wifi_set_channel(1, WIFI_SECOND_CHAN_NONE);
    quickEspNow.begin(1);
    quickEspNow.onDataRcvd(onData);
    
    prefs.begin("mac_store", true);
    prefs.getBytes("macA", macA, 6); prefs.getBytes("macB", macB, 6); prefs.getBytes("macC", macC, 6);
    prefs.end();

    prefs.begin("states", true);
    for (auto &c : channels) c.state = prefs.getBool(("ch" + String(c.id)).c_str(), false);
    prefs.end();

    // Inisialisasi awal ke Relay tanpa update HMI berlebihan
    for (auto &c : channels) {
        int rIdx = (c.id <= 6) ? c.id : (c.id <= 12 ? c.id - 6 : (c.id <= 18 ? c.id - 12 : c.id - 18));
        myData.channel = rIdx; 
        myData.state = c.state ? 0 : 1;
        quickEspNow.send(c.mac, (uint8_t*)&myData, sizeof(Payload));
        delay(10);
    }
    syncGlobalHmi();
}

void loop() {
    if (inputBuffer.length() > 0 && millis() - lastSerialTime > 50) inputBuffer = "";
    while (Serial2.available() > 0) {
        char c = Serial2.read();
        lastSerialTime = millis();
        if (c == '\n' || c == '\r') {
            inputBuffer.trim();
            if (inputBuffer.startsWith("prh ")) {
                handleCommand(inputBuffer.substring(4).toInt());
            }
            inputBuffer = "";
        } else {
            inputBuffer += c;
        }
    }
}
