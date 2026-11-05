import branding from "@/branding.json";
import assets from "@/lib/brand-assets.json";
export default function BrandStyles() {
  const css = branding.brandbook.fontFaces
    .map((face) => {
      const url = (assets as Record<string, string>)[face.url] || face.url;
      return `@font-face{font-family:${JSON.stringify(face.family)};font-weight:${face.weight};font-style:normal;font-display:swap;src:url(${JSON.stringify(url)})}`;
    })
    .join("\n");
  return <style>{css}</style>;
}
