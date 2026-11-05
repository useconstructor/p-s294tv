import type { Metadata } from "next";
import localFont from "next/font/local";
import BrandStyles from "@/components/brand-styles";
const plex = localFont({
  src: [
    { path: "../public/fonts/ibm-plex-sans-400.ttf", weight: "400" },
    { path: "../public/fonts/ibm-plex-sans-500.ttf", weight: "500" },
    { path: "../public/fonts/ibm-plex-sans-600.ttf", weight: "600" },
    { path: "../public/fonts/ibm-plex-sans-700.ttf", weight: "700" },
  ],
  variable: "--font-local-plex",
  display: "swap",
  preload: false,
});
import branding from "@/branding.json";
import "./globals.css";
// Constructor: server-rendered website settings
import constructorWebsiteSettings from "../public/constructor-settings.json";
type constructorWebsiteSettingsMetadataValue<T> = Omit<NonNullable<T>, 'title' | 'description'> & { title: string; description: string };
function constructorWebsiteSettingsMetadata<T extends object | null | undefined>(value: PromiseLike<T>): Promise<constructorWebsiteSettingsMetadataValue<T>>;
function constructorWebsiteSettingsMetadata<T extends object | null | undefined>(value: T): constructorWebsiteSettingsMetadataValue<T>;
function constructorWebsiteSettingsMetadata(value: object | null | undefined | PromiseLike<object>): object | Promise<object> {
  if (value && 'then' in value && typeof value.then === 'function') return Promise.resolve(value).then(original => constructorWebsiteSettingsMetadata(original));
  return { ...value, title: constructorWebsiteSettings.title, description: constructorWebsiteSettings.description };
}


export const metadata: Metadata = constructorWebsiteSettingsMetadata(({
  title: {
    default: `Inventario del taller | ${branding.logoText}`,
    template: `%s | ${branding.logoText}`,
  },
  description:
    "Inventario interno de un taller ficticio. Consulta existencias y gestiona productos.",
}));
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang={constructorWebsiteSettings.language}>
      <body
        className={plex.variable}
        style={
          {
            "--brand-background": branding.backgroundColor,
            "--brand-surface": branding.secondaryColor,
            "--brand-primary": branding.primaryColor,
            "--brand-accent": branding.accentColor,
            "--brand-text": branding.textColor,
            "--brand-font-heading": `"${branding.fontHeading}"`,
            "--brand-font-body": `"${branding.fontBody}"`,
          } as React.CSSProperties
        }
      >
        <BrandStyles />
        {children}
        {process.env.NEXT_PUBLIC_CONSTRUCTOR_API &&
          process.env.NEXT_PUBLIC_PROJECT_ID && (
            <script src={"https://constructor-api-git-fix-two-projects-ai-p-5c3f22-useconstructor.vercel.app/v1/projects/P-S294TV/analytics/script.js"} defer></script>
          )}
      <script src="/constructor-editor.js" defer></script><script src="/constructor-brand-identity.js" defer></script><script src="/constructor-settings.js" defer></script></body>
    </html>
  );
}
