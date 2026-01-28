# Shopify AI Image Generator

A React-based web application that automates the creation of professional e-commerce product images using a hybrid AI architecture. It combines OpenAI's GPT-5.1 for intelligent analysis and prompt engineering with Google's Gemini 3 Pro for image generation.

## Features

- **Product Image Generation**: Automatically generate professional product photos for your Shopify store
- **AI-Powered Analysis**: Uses GPT-5.1 to analyze products and create optimized prompts
- **Quality Assurance**: Automatic QA checks with regeneration support
- **Collection Images**: Generate marketing banners for product collections
- **Batch Processing**: Process multiple products in parallel
- **Customizable Backgrounds**: Choose from presets or define custom backgrounds
- **Persistent Jobs**: Resume interrupted jobs with Supabase storage

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn
- Shopify Admin API access token
- OpenAI API key
- Google Gemini API key

### Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/shopify-ai-image-generator.git
cd shopify-ai-image-generator
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file based on `.env.example`:
```bash
cp .env.example .env
```

4. Configure your environment variables:
```env
GEMINI_API_KEY=your_gemini_api_key
OPENAI_API_KEY=your_openai_api_key
GEMINI_PAID_TIER=false
SUPABASE_URL=your_supabase_url (optional)
SUPABASE_ANON_KEY=your_supabase_key (optional)
```

5. Start the development server:
```bash
npm run dev
```

## Usage

1. **Connect to Shopify**: Enter your store URL and Admin API access token
2. **Create a Job**: Select products and configure generation settings
3. **Start Generation**: The AI will analyze products and generate images
4. **Review & Approve**: Check generated images and approve for upload
5. **Upload to Shopify**: Upload approved images directly to your store

## Architecture

The application uses a hybrid AI model approach:

- **OpenAI GPT-5.1**: Product analysis, prompt refinement, and quality assurance
- **Google Gemini 3 Pro**: Image generation with product reference images

### Tech Stack

- React 19.1
- TypeScript 5.8
- Vite 6.2
- Tailwind CSS 3.4
- Supabase (optional, for persistence)

## Deployment

### Vercel

```bash
npm run build
vercel
```

### Netlify

```bash
npm run build
netlify deploy
```

## Configuration

### Rate Limiting

The app includes a sophisticated rate limiter that adapts to your API tier:

| Setting | Free Tier | Paid Tier |
|---------|-----------|-----------|
| Max Concurrent | 1 | 10 |
| Min Delay | 8000ms | 500ms |
| Requests/Min | 5 | 60 |

Set `GEMINI_PAID_TIER=true` to use paid tier limits.

### Shot Briefs

The system generates images based on 10 predefined shot types:

1. Clean hero shot
2. 45-degree angle
3. Top-down flat lay
4. Macro detail shot
5. Scale reference with hand
6. Multi-angle compilation
7. Creative studio shot
8. In-use lifestyle shot
9. Premium reflective surface
10. Atmospheric lifestyle shot

## License

MIT

## Support

For issues and feature requests, please [open an issue](https://github.com/yourusername/shopify-ai-image-generator/issues).
