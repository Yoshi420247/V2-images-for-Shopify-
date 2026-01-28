# Setup Guide

## Quick Start

### 1. Get Your API Keys

#### OpenAI API Key
1. Go to https://platform.openai.com/api-keys
2. Click "Create new secret key"
3. Copy the key (starts with `sk-`)

#### Gemini API Key
1. Go to https://aistudio.google.com/apikey
2. Click "Create API key"
3. Copy the key

#### Supabase (Optional - for persistent storage)
1. Go to https://supabase.com/dashboard
2. Create a new project or select existing
3. Go to **Settings** → **API Keys**
4. Copy the **Project URL** and **Publishable key** (anon key)

---

### 2. Set Up Supabase Database

1. In your Supabase dashboard, go to **SQL Editor**
2. Click "New query"
3. Paste the contents of `supabase/migrations/001_initial_schema.sql`
4. Click "Run"

This creates:
- `jobs` table for storing generation jobs
- `generated-images` storage bucket for images
- Required security policies

---

### 3. Configure Environment Variables

#### For Local Development
Create a `.env` file:
```bash
cp .env.example .env
```

Edit `.env`:
```env
VITE_GEMINI_API_KEY=your_gemini_key
VITE_OPENAI_API_KEY=your_openai_key
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your_publishable_key
```

#### For Vercel Deployment
1. Go to your Vercel project → Settings → Environment Variables
2. Add each variable (without the `VITE_` prefix works too)

#### For Netlify Deployment
1. Go to Site settings → Environment variables
2. Add each variable

---

### 4. Set Up Shopify Access

1. Go to your Shopify Admin
2. Settings → Apps and sales channels → Develop apps
3. Click "Create an app"
4. Name it "AI Image Generator"
5. Configure Admin API scopes:
   - `read_products`
   - `write_products`
   - `read_product_listings`
   - `read_inventory` (optional)
6. Install the app
7. Copy the **Admin API access token** (starts with `shpat_`)

---

### 5. Run the App

```bash
npm install
npm run dev
```

Open http://localhost:5173 and enter:
- Your store URL (e.g., `my-store.myshopify.com`)
- Your Admin API access token

---

## Deployment

### Deploy to Vercel
```bash
npm install -g vercel
vercel
```

### Deploy to Netlify
```bash
npm install -g netlify-cli
netlify deploy --prod
```

---

## Troubleshooting

### "CORS error" when connecting to Shopify
The app uses a CORS proxy. If the default proxy doesn't work:
1. Deploy your own proxy using the Cloudflare Worker template
2. Update the proxy URL in the advanced settings

### "Rate limit exceeded"
- Free tier has strict limits (5 requests/min for Gemini)
- Set `VITE_GEMINI_PAID_TIER=true` if you have a paid account
- Reduce parallel processing in job settings

### Images not persisting
- Check that Supabase URL and key are correct
- Verify the storage bucket exists and policies are set
- Jobs will still work using localStorage as fallback
