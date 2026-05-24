# La Liga OBS Overlay

## URLs (after deploy)
- **Control Panel**: `https://your-app.vercel.app/control`
- **OBS Overlay**: `https://your-app.vercel.app/overlay`

## Setup

### 1. Supabase
1. Create a free project at https://supabase.com
2. Open **SQL Editor** and run the contents of `supabase-setup.sql`
3. Go to **Settings → API** and copy:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon` public key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`

### 2. Local dev
```bash
cp .env.local.example .env.local
# fill in your Supabase values
npm install
npm run dev
```

### 3. Deploy to Vercel
```bash
npx vercel
# or connect GitHub repo in Vercel dashboard
# Add env vars: NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY
```

### 4. OBS Browser Source
- Add Source → **Browser Source**
- URL: `https://your-app.vercel.app/overlay`
- Width: `1920`, Height: `1080`
- Tick **"Shutdown source when not visible"**
- The background is transparent — chroma key not needed
