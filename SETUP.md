# Setup Instructions

## 📦 Install Dependencies

### 1. Root Dependencies
```bash
npm install
```

### 2. Contracts
```bash
cd contracts
npm install
```

### 3. Backend
```bash
cd backend
npm install
```

### 4. Frontend
```bash
cd frontend
npm install
npm install react-hot-toast
```

## 🔧 Configuration

### Contracts
1. Copy `contracts/.env.example` to `contracts/.env`
2. Add your private key và Arc RPC URL

### Backend
1. Copy `backend/.env.example` to `backend/.env`
2. Update contract addresses sau khi deploy

### Frontend
1. Copy `frontend/.env.example` to `frontend/.env.local`
2. Update contract addresses và API URL
3. (Optional) Có thể cấu hình thêm `NEXT_PUBLIC_BACKEND_URL` nếu backend không chạy trên `http://localhost:3001`

## 🚀 Development

### Run Backend
```bash
cd backend
npm run dev
```

### Run Frontend
```bash
cd frontend
npm run dev
```

Frontend sẽ chạy trên `http://localhost:3000`.  
Arc Testnet Explorer (để kiểm tra tx): `https://testnet.arcscan.app`.

## 📝 Next Steps

Sau khi setup xong, tiếp tục với Phase 2: Smart Contracts

