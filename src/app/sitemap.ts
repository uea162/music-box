import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: "https://musicbox.uea162.top",
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}
