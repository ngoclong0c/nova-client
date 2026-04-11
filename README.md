# 🎮 Nova Client — Minecraft Launcher

Launcher Minecraft Java Edition phong cách Lunar Client, chạy thật trên Windows.

## Yêu cầu

- **Node.js** v18+ → https://nodejs.org
- **Java 17+** → https://adoptium.net (bắt buộc để chạy Minecraft)
- **Tài khoản Minecraft Java Edition** (mua tại minecraft.net)

## Cài đặt & Chạy

```bash
# 1. Cài dependencies
npm install

# 2. Chạy launcher (development)
npm start

# 3. Build file .exe cài đặt (production)
npm run build
# → File .exe xuất hiện trong thư mục dist/
```

## Cách dùng

1. Mở launcher → Nhấn **Đăng nhập với Microsoft**
2. Cửa sổ Microsoft mở ra → Đăng nhập tài khoản Minecraft
3. Chọn phiên bản Minecraft muốn chơi
4. (Tùy chọn) Nhập IP server để tự động kết nối khi vào game
5. Chọn lượng RAM cấp cho game
6. Nhấn **KHỞI ĐỘNG** — launcher sẽ tự tải về assets/libraries lần đầu

## Tính năng

- ✅ Đăng nhập Microsoft (tài khoản thật)
- ✅ Tải và chạy Minecraft Java từ 1.16.5 → 1.21.4
- ✅ Tự động tải assets, libraries từ Mojang
- ✅ Chọn RAM (1G → 8G)
- ✅ Tự động kết nối server sau khi vào game
- ✅ Console log theo dõi quá trình tải
- ✅ Toggle mods UI (OptiFine, Keystrokes, MiniMap...)
- ✅ Mở thư mục game (.nova-client trong AppData)

## Lưu ý

- Lần đầu chạy mỗi phiên bản sẽ tải ~300MB–500MB từ Mojang
- Game lưu tại: `%APPDATA%\.nova-client\`
- Để cài Fabric/Forge mod thật: copy vào thư mục `mods/` trong game dir
- Java phải được cài và có trong PATH (gõ `java -version` để kiểm tra)

## Build .exe

```bash
npm run build
```
File installer sẽ xuất hiện tại `dist/Nova Client Setup.exe`
