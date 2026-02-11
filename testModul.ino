// Daftar pin relay sesuai permintaan Anda
//const int relayPins[] = {4, 12, 17, 27, 32, 33}; // MODUL RELAY
const int relayPins[] = {5, 4 ,12 , 27 , 32 , 33};  // MODUL DIMMER
const int jumlahRelay = 6; // Total ada 6 pin

void setup() {
  // Mengatur semua pin sebagai OUTPUT
  for (int i = 0; i < jumlahRelay; i++) {
    pinMode(relayPins[i], OUTPUT);
    // Pastikan semua relay mati saat pertama kali menyala
    digitalWrite(relayPins[i], HIGH); 
  }
  
  Serial.begin(115200);
  Serial.println("Tes Relay Dimulai...");
}

void loop() {
  // Menyalakan relay satu per satu
  for (int i = 0; i < jumlahRelay; i++) {
    Serial.print("Menyalakan Relay pada Pin: ");
    Serial.println(relayPins[i]);
    
    digitalWrite(relayPins[i], LOW);  // LOW biasanya menyalakan relay (Active Low)
    delay(2000);                      // Tunggu 2 detik
    
    digitalWrite(relayPins[i], HIGH); // Matikan kembali
    delay(1000);                      // Tunggu 1 detik sebelum pindah ke relay berikutnya
  }
  
  Serial.println("Semua relay sudah dites. Mengulang kembali...");
  delay(3000); // Tunggu 3 detik sebelum mengulang tes dari awal
}
