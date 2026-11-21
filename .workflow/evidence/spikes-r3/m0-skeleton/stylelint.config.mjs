// Stylelint：组件 CSS 里禁硬编码颜色（hex/named），tokens.css 与播放器舞台豁免。
export default {
  ignoreFiles: [
    "**/tokens.css",
    "**/player*.css",
    "**/stage*.css",
    "**/dist/**",
    "**/out/**",
  ],
  rules: {
    "color-no-hex": true,
    "color-named": "never",
  },
};
