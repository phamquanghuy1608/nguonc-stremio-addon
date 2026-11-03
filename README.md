# NguonC Stremio & Nuvio Addon (Vercel Serverless)

Addon Stremio / Nuvio cho nguồn phim [NguonC (phim.nguonc.com)](https://phim.nguonc.com), triển khai dạng Serverless Function trên Vercel giống như KKPhim (`kkphim-stremio-addon.vercel.app`).

---

## 🚀 Tính năng

- **Catalogs**: Mới Cập Nhật, Phim Bộ, Phim Lẻ, Hoạt Hình, TV Shows.
- **Search**: Tìm kiếm theo tên phim trực tiếp từ ô tìm kiếm của Stremio / Nuvio.
- **IMDb / TMDB Mapping**: Tự động giải mã ID IMDb (`tt...`) và TMDB sang phim NguonC.
- **Stream Giải Mã AES-GCM**: Tự động giải mã bootstrap của `embed.streamc.xyz` bằng Web Crypto AES-GCM (thuần Node.js 18+, không cần Chrome/Puppeteer).
- **HLS Proxy & Direct**: Cung cấp 2 lựa chọn stream: qua proxy HLS (chống chặn Referer) và Direct Stream.

---

## 📦 Cách Triển Khai Lên Vercel

### Cách 1: Qua GitHub (Khuyên dùng)
1. Đẩy thư mục này lên một repository GitHub cá nhân (ví dụ: `nguonc-stremio-addon`).
2. Mở [Vercel Dashboard](https://vercel.com/dashboard) -> Chọn **Add New Project** -> Chọn repository vừa tạo.
3. Giữ nguyên cấu hình mặc định (Framework Preset: **Other**) -> Nhấn **Deploy**.
4. Sau khi deploy xong, bạn sẽ có URL dạng `https://nguonc-stremio-addon.vercel.app`.
5. Link manifest để cài đặt vào Stremio/Nuvio:
   ```
   https://<tên-project-của-bạn>.vercel.app/manifest.json
   ```

### Cách 2: Qua Vercel CLI
Nếu máy có cài đặt `vercel`:
```bash
cd nguonc-stremio-addon
npx vercel
```
Làm theo hướng dẫn trên terminal để deploy trực tiếp.

---

## 🛠️ Chạy Thử Ở Local (Tùy chọn)

```bash
npm install
npm start
```
Mở trình duyệt truy cập: `http://localhost:7003` hoặc `http://localhost:7003/manifest.json`.
