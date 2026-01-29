# Fuck You Bitch 🖕

PARA BAJINGAN YANG TERHORMAT, MOHON DIPERHTIKAN DENGAN SEKSAMA

## installation

### Hardware Side

1. anda perlu melepaskan modul relay yang disebut juga Slave A, modul dimmer (Slave A dan B) dan juga modul yang memiliki LCD / modulmaster. kmudian anda perlu menjumper pin power esp32 dengan output regulator 3,3 volt yang sudah dimiliki oleh masing masing modul.
2. pastikan anda juga sudah mengecek terkait dengan kinerja modul, pastikan tidak ada mosfet pada dimmer yang rusak, pastikan juga semua relay bekerja.

### Software Side

1. perisapan pada sisi laptop untuk anda memprogram ulang modul, anda perlu menginstall software arduino ide sebagai jembatan untuk melakukan proses compile program, lalu anda juga perlu melakukan installasi beberapa library yang dibutuhkan oleh kode yang sudah disapkan agar proses compilasi berjalan dan tidak terjadi error, library nya antara lain
   . RcSwitchReceiver.h
   .
kemudian anda perlu menginstall board esp32 pada arduino ide terlebih dahulu agar board esp32 anda bisa di deteksi, jika arduino ide anda belum memiliki board esp32 maka copy link ini https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json dan pergi ke File->Preferences lalu masukkan pada additional board URLs.

2. jika sudah melakukan persiapan lingkungan kompilasi kode di atas kita masuk pada proses setting kode, anda perlu mesetting LMK dan PMK key pada setiap ruangan, ini untuk memastikan tidak adanya ruangan yang dapat mengontrol ruangan lainnya karena kesamaan kunci.

3. lalu anda perlu mengubah beberapa settingan pada sisi slave, karena satu file kode di jadikan untuk 3 modul anda harus merubah tipe modul menjadi A untuk relay, B dan C untuk modul dimmer, lalu lakukan juga perubahan pada bagian definisi pin, dimana ada terdapat 2 jenis pin yaitu jenis pin relay dan juga pin dimmer, berikan tanda "//" ini membuat kodenya tidak aktif atau mausuk ke dalam komentar

4. setelh itu anda bisa mengcompile serta mengupload kodenya, ke dalam masing masing modul, setiap modul akan mengeluarkan alamat mac adrresnya, anda dapat melihat alamat mac adrresnya pada bagian serial monitor arduino ide.

5. setelah itu masuk ke dalam proses memasukkan mac address ke dalam kode, mac adress akan memiliki format seperti ini saat muncul di serial monitor 30:C6:F7:45:0B:FC, namun anda perlu mengubahnya menjadi seperti ini pada saat anda memasukkannya ke dalam masing masing kode modul 0x30,0xC6,0xF7,0x45,0x0B,0xFC.

6. setelah semua itu selesai anda dapat melakukan instalasi jalur lampu pada masing masing chanel yang sudah di pasang, anda perlu melihat chanel mana yang aktif dan tidak untuk mengetahui ia masuk pada lampu apa.

--GOOD LUCK ASSHOLE-- 
