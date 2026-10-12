---
title: Blog
outline: false
---

# Blog

A window into my world.

<script setup>
import { data as posts } from './posts.data'
</script>

<ul class="posts">
  <li v-for="post in posts" :key="post.url">
    <a :href="post.url">{{ post.title }}</a>
    <time :datetime="post.date">{{ post.dateLabel }}</time>
  </li>
</ul>

<style>
.posts {
  list-style: none;
  padding: 0;
}

.posts li {
  margin: 1.5rem 0;
}

.posts a {
  font-size: 1.15rem;
  font-weight: 600;
}

.posts time {
  display: block;
  margin-top: 0.25rem;
  color: var(--vp-c-text-2);
  font-size: 0.9rem;
}
</style>
