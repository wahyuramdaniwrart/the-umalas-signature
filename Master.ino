#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <Preferences.h>

#define PMK_KEY "MasterKeyRumah10"
#define LMK_KEY "LocalKeyRelay002"

typedef struct
{
    char roomID[10];
    uint8_t channel;
    uint8_t state;
} Payload;

typedef struct
{
    uint8_t mac[6];
    Payload data;
} QueueItem;

// --- ISI MAC ADDRESS SLAVE DI SINI ---
uint8_t macA[6] = {0x30, 0xC6, 0xF7, 0x45, 0x1F, 0xA0}; // Ganti ke MAC Modul A
uint8_t macB[6] = {0xB0, 0xA7, 0x32, 0x35, 0x5C, 0x0C}; // Ganti ke MAC Modul B
uint8_t macC[6] = {0xB0, 0xA7, 0x32, 0x34, 0x2F, 0xB4}; // Ganti ke MAC Modul C
uint8_t bcastMac[] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};

const char *MY_ROOM_ID = "BG12";

Preferences prefs;
String inputBuffer = "";
unsigned long lastSerialTime = 0;
bool isPairingModul = false;
QueueHandle_t sendQueue;

struct Channel
{
    int id;
    uint8_t *mac;
    int rly;
    bool state;
    String obj;
};

Channel channels[] = {
    {8, macB, 2, false, "bt_8"}, {7, macB, 1, false, "bt_7"}, {19, macC, 1, false, "bt_19"}, {9, macB, 3, false, "bt_9"}, {12, macB, 6, false, "bt_12"}, {10, macB, 4, false, "bt_10"}, {11, macB, 5, false, "bt_11"}, {13, macC, 1, false, "bt_13"}, {15, macA, 3, false, "bt_15"}, {14, macC, 2, false, "bt_14"}, {20, macC, 3, false, "bt_20"}, {1, macA, 1, false, "bt_1"}, {2, macA, 4, false, "bt_2"}, {16, macC, 4, false, "bt_16"}, {17, macC, 5, false, "bt_17"}, {18, macC, 6, false, "bt_18"}};

struct Group
{
    String name;
    int chs[5];
    int count;
    String hmiObj;
};

Group groups[] = {
    {"Kitchen", {7, 8, 9, 19}, 4, "btKitchen"},
    {"Living", {10, 11, 12}, 3, "btLivingroom"},
    {"Bedroom", {13, 14, 15, 20}, 4, "btBedroom"},
    {"Bathroom", {1, 2, 16}, 3, "btBathroom"},
    {"Balcony", {17, 18}, 2, "btBalcony"}};

void updateHmi(String cmd)
{
    Serial2.print(cmd);
    Serial2.write(0xff);
    Serial2.write(0xff);
    Serial2.write(0xff);
}

void syncGlobalHmi()
{
    int totalChannels = sizeof(channels) / sizeof(channels[0]);
    int totalOnGlobal = 0;
    for (auto &g : groups)
    {
        int onCountInGroup = 0;
        for (int i = 0; i < g.count; i++)
        {
            for (auto &c : channels)
            {
                if (c.id == g.chs[i])
                {
                    if (c.state)
                        onCountInGroup++;
                    break;
                }
            }
        }
        if (onCountInGroup == g.count)
            updateHmi(g.hmiObj + ".val=1");
        else if (onCountInGroup == 0)
            updateHmi(g.hmiObj + ".val=0");
    }
    for (auto &c : channels)
    {
        updateHmi(c.obj + ".val=" + String(c.state ? "1" : "0"));
        if (c.state)
            totalOnGlobal++;
    }
    if (totalOnGlobal == totalChannels)
        updateHmi("bt1.val=1");
    else if (totalOnGlobal == 0)
        updateHmi("bt1.val=0");

    updateHmi("nomorKamar.txt=\"" + String(MY_ROOM_ID) + "\"");
}

void enqueueData(uint8_t *mac, uint8_t rIdx, uint8_t st)
{
    QueueItem item;
    memcpy(item.mac, mac, 6);
    strncpy(item.data.roomID, MY_ROOM_ID, sizeof(item.data.roomID));
    item.data.channel = rIdx;
    item.data.state = st;
    xQueueSend(sendQueue, &item, pdMS_TO_TICKS(10));
}

void processSendQueue(void *pvParameters)
{
    QueueItem item;
    for (;;)
    {
        if (xQueueReceive(sendQueue, &item, portMAX_DELAY))
        {
            esp_now_send(item.mac, (uint8_t *)&item.data, sizeof(Payload));
            vTaskDelay(pdMS_TO_TICKS(35));
        }
    }
}

void registerPeer(uint8_t *mac, bool encrypt)
{
    esp_now_peer_info_t peerInfo = {};
    memcpy(peerInfo.peer_addr, mac, 6);
    peerInfo.channel = 0;
    peerInfo.encrypt = encrypt;
    if (encrypt)
    {
        for (int i = 0; i < 16; i++)
            peerInfo.lmk[i] = LMK_KEY[i];
    }
    if (esp_now_is_peer_exist(mac))
        esp_now_del_peer(mac);
    esp_now_add_peer(&peerInfo);
}

void OnDataRecv(const uint8_t *mac, const uint8_t *incomingData, int len)
{
    if (len == sizeof(Payload))
    {
        Payload *feedback = (Payload *)incomingData;
        if (strcmp(feedback->roomID, MY_ROOM_ID) == 0)
        {
            for (auto &c : channels)
            {
                int rIdx = (c.id <= 6) ? c.id : (c.id <= 12 ? c.id - 6 : (c.id <= 18 ? c.id - 12 : c.id - 18));
                if (memcmp(c.mac, mac, 6) == 0 && rIdx == (int)feedback->channel)
                {
                    bool newState = (feedback->state == 0);
                    if (c.state != newState)
                    {
                        c.state = newState;
                        syncGlobalHmi();
                    }
                    break;
                }
            }
        }
    }
}

void setChannel(int chId, bool state, bool skipSync = false)
{
    for (auto &c : channels)
    {
        if (c.id == chId)
        {
            if (c.state == state)
                return;
            c.state = state;
            prefs.begin("states", false);
            prefs.putBool(("ch" + String(chId)).c_str(), state);
            prefs.end();
            int rIdx = (chId <= 6) ? chId : (chId <= 12 ? chId - 6 : (chId <= 18 ? chId - 12 : chId - 18));
            enqueueData(c.mac, (uint8_t)rIdx, state ? 0 : 1);
            if (!skipSync)
                syncGlobalHmi();
            break;
        }
    }
}

void handleCommand(int id)
{
    // 1. ALL ON / ALL OFF
    if (id == 0 || id == 1)
    {
        bool target = (id == 0);
        for (auto &c : channels)
        {
            setChannel(c.id, target, true);
        }
        syncGlobalHmi();
    }

    else if (id == 60)
    {
        updateHmi("setting.tStatus.txt=\"REBOOTING MASTER...\"");
        delay(500);    // Beri waktu sebentar untuk kirim data ke HMI
        ESP.restart(); // Perintah untuk merestart ESP32
    }

    // 2. GROUPING (Kitchen, Living, dll)
    else if (id >= 2 && id <= 11)
    {
        int gIdx = (id - 2) / 2;
        bool target = (id % 2 == 0);
        if (gIdx >= 0 && gIdx < 5)
        {
            for (int i = 0; i < groups[gIdx].count; i++)
            {
                setChannel(groups[gIdx].chs[i], target, true);
            }
            syncGlobalHmi();
        }
    }

    // 3. FITUR PAIRING SAKLAR KINETIK (RF PAIRING)
    else if (id == 14 || id == 16 || id == 18 || id == 20)
    {
        uint8_t *tMac = NULL;
        int rIdx = 0;

        switch (id)
        {
        case 14: // Modul A, Relay 1
            tMac = macA;
            rIdx = 1;
            break;
        case 18: // Modul A, Relay 2
            tMac = macA;
            rIdx = 2;
            break;
        case 16: // Modul C, Relay 4 (Sesuai logika ID 16 Anda)
            tMac = macC;
            rIdx = 4;
            break;
        case 20: // Modul C, Relay 5
            tMac = macC;
            rIdx = 5;
            break;
        }

        if (tMac != NULL)
        {
            // Mengirim perintah 0xFE ke Slave untuk masuk mode Pairing RF
            enqueueData(tMac, (uint8_t)rIdx, 0xFE);
            updateHmi("setting.tStatus.txt=\"PAIR RF CH:" + String(id) + "...\"");
        }
    }

    // 4. TOMBOL CHANNEL INDIVIDUAL
    else if (id >= 22 && id <= 53)
    {
        int channelList[] = {8, 7, 19, 9, 12, 10, 11, 13, 15, 14, 20, 1, 2, 16, 17, 18};
        int chIdx = (id - 22) / 2;
        if (chIdx >= 0 && chIdx < 16)
        {
            setChannel(channelList[chIdx], (id % 2 == 0));
        }
    }

    else if (id == 12)
    {
        // Mengirim perintah 0xFD (Reset RF) ke semua modul
        enqueueData(macA, 0, 0xFD);
        enqueueData(macB, 0, 0xFD);
        enqueueData(macC, 0, 0xFD);

        updateHmi("setting.tStatus.txt=\"RESET SEMUA RF...\"");
    }
    else if (id == 13)
    {
        updateHmi("setting.tStatus.txt=\"READY\"");
    }

    else if (id == 100)
        syncGlobalHmi();
}

void setup()
{
    Serial.begin(115200);
    Serial2.begin(9600, SERIAL_8N1, 16, 17);
    sendQueue = xQueueCreate(50, sizeof(QueueItem));

    WiFi.mode(WIFI_STA);
    Serial.println("");
    Serial.println("======================================");
    Serial.print("MAC ADDRESS MASTER: ");
    Serial.println(WiFi.macAddress());
    Serial.println("======================================");
    WiFi.disconnect();

    if (esp_now_init() != ESP_OK)
        ESP.restart();
    esp_now_set_pmk((uint8_t *)PMK_KEY);
    esp_now_register_recv_cb(OnDataRecv);

    // Langsung daftarkan peer tanpa ambil dari memory preferences
    registerPeer(macA, true);
    registerPeer(macB, true);
    registerPeer(macC, true);
    registerPeer(bcastMac, false);

    prefs.begin("states", true);
    for (auto &c : channels)
        c.state = prefs.getBool(("ch" + String(c.id)).c_str(), false);
    prefs.end();

    xTaskCreate(processSendQueue, "SendQueueTask", 2048, NULL, 1, NULL);
    syncGlobalHmi();
}

void loop()
{
    while (Serial2.available() > 0)
    {
        char c = Serial2.read();
        lastSerialTime = millis();
        if (c == '\n' || c == '\r')
        {
            inputBuffer.trim();
            if (inputBuffer.startsWith("prh "))
            {
                handleCommand(inputBuffer.substring(4).toInt());
            }
            inputBuffer = "";
        }
        else
        {
            inputBuffer += c;
        }
    }
    if (inputBuffer.length() > 0 && millis() - lastSerialTime > 50)
        inputBuffer = "";
}