## Apple-inspired design system

This project follows a design system inspired by Apple’s web UI: **neutral, cinematic surfaces** with a **single blue accent** reserved for interactivity. The UI should feel “invisible” and let content lead.

### Philosophy
- **Minimalism as reverence**: remove decoration that doesn’t serve clarity.
- **Controlled contrast**: light content areas on `#f5f5f7`, dark “glass” navigation surfaces with blur.
- **One accent color**: blue is reserved for interaction and focus.

## Tokens

### Colors
- **Background (light)**: `#f5f5f7`
- **Surface**: `#ffffff`
- **Surface soft**: `#fafafc`
- **Text**: `#1d1d1f`
- **Muted text**: `rgba(0,0,0,0.8)`
- **Muted 2**: `rgba(0,0,0,0.48)`
- **Border**: `rgba(0,0,0,0.08)`

### Interactive
- **Primary (Apple Blue)**: `#0071e3`
- **Link (light bg)**: `#0066cc`
- **Link (dark bg)**: `#2997ff`
- **Focus ring**: `#0071e3`

### Shadow (rare)
- **Card shadow**: `rgba(0,0,0,0.22) 3px 5px 30px 0px`

## Typography

### Font stack
Use the system SF stack (SF Pro on macOS/iOS):
- `-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "SF Pro Icons", Helvetica, Arial, sans-serif`

### Rules
- Prefer **tight tracking** (subtle negative letter-spacing) across sizes.
- Keep headlines **tight line-heights** (about `1.10–1.14`) and semibold weight.
- Body text uses a comfortable rhythm around `line-height: 1.47`.

## Components

### Buttons
- **Primary**: blue background, white text, subtle brighten on hover.
- **Shape**: pill radius (`980px`) for primary CTAs.
- **Focus**: visible blue focus ring.

### Navigation (“glass”)
- Dark translucent background: `rgba(0,0,0,0.8)`
- `backdrop-filter: saturate(180%) blur(20px)`
- White text; avoid additional accent colors.

## Do / Don’t

### Do
- Use blue **only** for interactive elements and focus.
- Keep surfaces clean and flat (shadows are rare).
- Use whitespace to separate sections, not decoration.

### Don’t
- Don’t introduce new accent colors.
- Don’t add heavy borders or multiple shadow layers.
- Don’t use loud gradients/textures behind content.

## Implementation

The system tokens and most component styling live in:
- `src/index.css`

