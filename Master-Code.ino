#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <Preferences.h>

// --- KONFIGURASI KEAMANAN (AES-128 Hardware) ---
// PMK: Primary Master Key (16 Karakter) - Digunakan untuk mengamankan pertukaran LMK
#define PMK_KEY "MasterKeyRumah01" 
// LMK: Local Master Key (16 Karakter) - Digunakan untuk enkripsi data tiap paket
#define LMK_KEY "LocalKeyRelay_01"

// --- STRUKTUR DATA (PAYLOAD) ---
typedef struct {
    uint8_t roomID;   // Filter ID Ruangan (Contoh: 101)
    uint8_t channel;  // Index Relay pada modul (1-6)
    uint8_t state;    // 0=ON, 1=OFF (Active Low), 0xFE/0xFD untuk RF Pairing
} Payload;

Payload myData;

// --- KONFIGURASI MAC & RUANGAN ---
uint8_t macA[6], macB[6], macC[6];
uint8_t bcastMac[] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};

const uint8_t MY_ROOM_ID = 101; 

// --- MAPPING CHANNEL & HMI ---
struct Channel {
    int id; uint8_t* mac; int rly; bool state; String obj;
};

Channel channels[] = {
    {8, macB, 2, false, "bt_8"}, {7, macB, 1, false, "bt_7"}, {19, macC, 1, false, "bt_19"},
    {9, macB, 3, false, "bt_9"}, {12, macB, 6, false, "bt_12"}, {10, macB, 4, false, "bt_10"},
    {11, macB, 5, false, "bt_11"}, {13, macC, 1, false, "bt_13"}, {15, macC, 3, false, "bt_15"},
    {14, macC, 2, false, "bt_14"}, {20, macC, 2, false, "bt_20"}, {1, macA, 1, false, "bt_1"},
    {2, macA, 2, false, "bt_2"}, {16, macC, 4, false, "bt_16"}, {17, macC, 5, false, "bt_17"},
    {18, macC, 6, false, "bt_18"}
};

// --- STRUKTUR GRUP ---
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

// --- VARIABLE GLOBAL ---
Preferences prefs;
String inputBuffer = "";
unsigned long lastSerialTime = 0;
bool isPairingModul = false;

// --- FUNGSI HMI NEXTION ---
void updateHmi(String cmd) {
    Serial2.print(cmd);
    Serial2.write(0xff); Serial2.write(0xff); Serial2.write(0xff);
}

// --- SINKRONISASI STATUS HMI ---
void syncGlobalHmi() {
    int totalChannels = sizeof(channels) / sizeof(channels[0]);
    int totalOnGlobal = 0;

    // 1. Update status Group
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
        if (onCountInGroup == g.count) updateHmi(g.hmiObj + ".val=1");
        else if (onCountInGroup == 0) updateHmi(g.hmiObj + ".val=0");
    }

    // 2. Update Visual Individual & Hitung Total ON
    for (auto &c : channels) {
        updateHmi(c.obj + ".val=" + String(c.state ? "1" : "0"));
        if (c.state) totalOnGlobal++;
    }

    // 3. Logika Master Utama (bt1)
    if (totalOnGlobal == totalChannels) updateHmi("bt1.val=1");
    else if (totalOnGlobal == 0) updateHmi("bt1.val=0");
}

// --- FUNGSI NATIVE ESP-NOW PEER ---
void registerPeer(uint8_t* mac, bool encrypt) {
    esp_now_peer_info_t peerInfo = {};
    memcpy(peerInfo.peer_addr, mac, 6);
    peerInfo.channel = 0; 
    peerInfo.encrypt = encrypt;
    
    if (encrypt) {
        for (int i = 0; i < 16; i++) peerInfo.lmk[i] = LMK_KEY[i];
    }

    if (esp_now_is_peer_exist(mac)) {
        esp_now_del_peer(mac);
    }
    esp_now_add_peer(&peerInfo);
}

// --- CALLBACK TERIMA DATA (FEEDBACK & PAIRING) ---
void OnDataRecv(const uint8_t * mac, const uint8_t *incomingData, int len) {
    // A. Logika Pairing Modul
    if (isPairingModul && len == 6 && incomingData[0] == 'H') {
        char type = (char)incomingData[5];
        prefs.begin("mac_store", false);
        if (type == 'A') { memcpy(macA, mac, 6); prefs.putBytes("macA", macA, 6); }
        else if (type == 'B') { memcpy(macB, mac, 6); prefs.putBytes("macB", macB, 6); }
        else if (type == 'C') { memcpy(macC, mac, 6); prefs.putBytes("macC", macC, 6); }
        prefs.end();
        
        registerPeer((uint8_t*)mac, true);
        updateHmi("setting.tStatus.txt=\"MODUL " + String(type) + " OK\"");
    } 
    // B. Logika Feedback (Update HMI)
    else if (len == sizeof(Payload)) {
        Payload* feedback = (Payload*)incomingData;
        if (feedback->roomID == MY_ROOM_ID) {
            for (auto &c : channels) {
                int rIdx = (c.id <= 6) ? c.id : (c.id <= 12 ? c.id - 6 : (c.id <= 18 ? c.id - 12 : c.id - 18));
                if (memcmp(c.mac, mac, 6) == 0 && rIdx == (int)feedback->channel) {
                    bool newState = (feedback->state == 0);
                    if (c.state != newState) {
                        c.state = newState;
                        syncGlobalHmi();
                    }
                    break;
                }
            }
        }
    }
}

// --- FUNGSI PENGIRIMAN ---
void sendData(uint8_t* mac, uint8_t rIdx, uint8_t st) {
    myData.roomID = MY_ROOM_ID;
    myData.channel = rIdx;
    myData.state = st; // Data st sudah diolah di setChannel
    esp_now_send(mac, (uint8_t *) &myData, sizeof(Payload));
}

void setChannel(int chId, bool state, bool skipSync = false) {
    for (auto &c : channels) {
        if (c.id == chId) {
            if (c.state == state) return;
            c.state = state;

            prefs.begin("states", false);
            prefs.putBool(("ch" + String(chId)).c_str(), state);
            prefs.end();

            int rIdx = (chId <= 6) ? chId : (chId <= 12 ? chId - 6 : (chId <= 18 ? chId - 12 : chId - 18));
            
            // PERBAIKAN LOGIKA DISINI:
            // Jika state true (ON dari HMI), kirim 0 (Active Low Relay)
            // Jika state false (OFF dari HMI), kirim 1
            sendData(c.mac, (uint8_t)rIdx, state ? 0 : 1); 
            
            if (!skipSync) syncGlobalHmi();
            break;
        }
    }
}

// --- HANDLER SERIAL HMI ---
void handleCommand(int id) {
    // Master All
    if (id == 0 || id == 1) {
        bool target = (id == 0); 
        for (auto &c : channels) { setChannel(c.id, target, true); delay(10); }
        syncGlobalHmi();
    }
    // Group Command
    else if (id >= 2 && id <= 11) {
        int gIdx = (id - 2) / 2;
        bool target = (id % 2 == 0);
        for (int i = 0; i < groups[gIdx].count; i++) {
            setChannel(groups[gIdx].chs[i], target, true);
            delay(10);
        }
        syncGlobalHmi();
    }
    // Pairing Modul
    else if (id == 12 || id == 13) {
        isPairingModul = (id == 12);
        if(isPairingModul) {
            uint8_t q[] = {'W','H','O','I','S'};
            esp_now_send(bcastMac, q, 5);
        }
        updateHmi("setting.tStatus.txt=\"" + String(isPairingModul ? "PAIRING..." : "READY") + "\"");
    }
    // RF Kinetic Pairing
    else if (id >= 14 && id <= 21) {
        int chMap[] = {7, 7, 8, 8, 9, 9, 17, 17};
        int targetCh = chMap[id-14];
        uint8_t* tMac = (targetCh <= 6) ? macA : (targetCh <= 12 ? macB : macC);
        int rIdx = (targetCh > 12 ? targetCh-12 : (targetCh > 6 ? targetCh-6 : targetCh));
        sendData(tMac, (uint8_t)rIdx, (id % 2 == 0 ? 0xFE : 0xFD));
    }
    // Individual Button
    else if (id >= 22 && id <= 53) {
        int channelList[] = {8,7,19,9,12,10,11,13,15,14,20,1,2,16,17,18};
        int chIdx = (id - 22) / 2;
        setChannel(channelList[chIdx], (id % 2 == 0));
    }
    // Refresh
    else if (id == 100) syncGlobalHmi();
}

// --- SETUP UTAMA ---
void setup() {
    Serial.begin(115200);
    Serial2.begin(9600, SERIAL_8N1, 16, 17);

    WiFi.mode(WIFI_STA);
    WiFi.disconnect();

    // Inisialisasi Native ESP-NOW
    if (esp_now_init() != ESP_OK) {
        Serial.println("Gagal Init ESP-NOW");
        ESP.restart();
    }

    // Set PMK (Primary Master Key)
    esp_now_set_pmk((uint8_t *)PMK_KEY);

    // Register Callback
    esp_now_register_recv_cb(OnDataRecv);

    // Load MAC & Register Peers (dengan Enkripsi LMK)
    prefs.begin("mac_store", true);
    prefs.getBytes("macA", macA, 6); 
    prefs.getBytes("macB", macB, 6); 
    prefs.getBytes("macC", macC, 6);
    prefs.end();

    registerPeer(macA, true);
    registerPeer(macB, true);
    registerPeer(macC, true);
    registerPeer(bcastMac, false); // Broadcast tidak boleh dienkripsi

    // Load States
    prefs.begin("states", true);
    for (auto &c : channels) c.state = prefs.getBool(("ch" + String(c.id)).c_str(), false);
    prefs.end();

    syncGlobalHmi();
}

// --- LOOP UTAMA ---
void loop() {
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
    // Timeout buffer
    if (inputBuffer.length() > 0 && millis() - lastSerialTime > 50) inputBuffer = "";
}
