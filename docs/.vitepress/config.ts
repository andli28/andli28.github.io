import { defineConfig } from 'vitepress'
import markdownItKatex from 'markdown-it-katex'

export default defineConfig({
  title: 'Andrew Li',
  description:
    'Computer Science and Statistics student at the University of Michigan.',
  themeConfig: {
    outline: false,
    nav: [
      { text: 'Blog', link: '/blog/', activeMatch: '/blog/' },
      {
        text: 'LinkedIn',
        link: 'https://www.linkedin.com/in/andli28/',
      },
      { text: 'GitHub', link: 'https://github.com/andli28' },
    ],
  },
  markdown: {
    config(md) {
      md.use(markdownItKatex)
    },
  },
})
