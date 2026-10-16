import type {
  ExpressiveCodeConfig,
  LicenseConfig,
  NavBarConfig,
  ProfileConfig,
  SiteConfig,
} from "./types/config";
import { LinkPreset } from "./types/config";

export const siteConfig: SiteConfig = {
  title: "sk",
  subtitle: "this is my blog",
  lang: "zh_CN",
  themeColor: { hue: 250, fixed: false },
  banner: {
    enable: true,
    src: "/image/back.jpg",
    position: "center",
    credit: { enable: false, text: "", url: "" },
  },
  toc: { enable: true, depth: 2 },
  favicon: [],
};

export const navBarConfig: NavBarConfig = {
  links: [
    LinkPreset.Home,
    LinkPreset.Archive,
    LinkPreset.About,
    {
      name: "GitHub",
      url: "https://github.com/sk233333/sk233333.github.io",
      external: true,
    },
  ],
};

export const profileConfig: ProfileConfig = {
  avatar: "/123.jpg",
  name: "sk",
  bio: "e",
  links: [
    { name: "GitHub", icon: "fa6-brands:github",  url: "https://github.com/sk233333" },
    { name: "Steam",  icon: "fa6-brands:steam",   url: "https://store.steampowered.com" },
  ],
};

export const licenseConfig: LicenseConfig = {
  enable: true,
  name: "CC BY-NC-SA 4.0",
  url: "https://creativecommons.org/licenses/by-nc-sa/4.0/",
};

export const expressiveCodeConfig: ExpressiveCodeConfig = {
  theme: "one-dark-pro",
};
