# Store Rating App (small version)

Stack: Express + MySQL + React (Vite)

## Setup
1. Create the database in MySQL:
   ```
   mysql -u root -p -e "CREATE DATABASE store_rating;"
   ```
2. Backend:
   ```
   cd backend
   cp .env.example .env     # put your MySQL password in DB_PASSWORD
   npm install
   npm start
   ```
   Tables are created automatically from schema.sql, plus a default admin:
   **admin@example.com / Admin@123**
3. Frontend (new terminal):
   ```
   cd frontend
   npm install
   npm run dev
   ```
   Open http://localhost:5173

## Flow
- Admin logs in -> adds a store owner (role OWNER) and stores (use the owner's user ID).
- Normal users sign up on the register page, search stores, submit/modify ratings (1-5).
- Store owners see their raters and average rating.
