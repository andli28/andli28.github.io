import { defineConfig } from 'vitepress'
import markdownItKatex from 'markdown-it-katex'

export default defineConfig({
  title: 'Andrew Li',
  description: 'Notes on machine learning and systems.',
  markdown: {
    config(md) {
      md.use(markdownItKatex)
    },
  },
})
