<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useApp } from './composables/useApp'

const { state, hasSheet, hydrate } = useApp()
const route = useRoute()
const router = useRouter()
const bare = computed(() => Boolean(route.meta.bare))
const tab = computed(() => String(route.meta.tab || ''))

function maybeRedirect() {
  if (!state.ready) return
  const needsSetup = !state.signedIn || !hasSheet.value
  if (needsSetup && route.name !== 'setup') {
    router.replace({ name: 'setup' })
  } else if (!needsSetup && route.name === 'setup') {
    router.replace({ name: 'home' })
  }
}

onMounted(async () => {
  await hydrate()
  maybeRedirect()
})

watch(
  () => [state.ready, state.signedIn, hasSheet.value, route.name],
  () => maybeRedirect(),
)
</script>

<template>
  <div class="app-shell">
    <div v-if="!state.ready" class="page center">
      <p class="muted">載入中<span class="loading-dots"></span></p>
    </div>
    <router-view v-else />
    <nav v-if="state.ready && !bare" class="tab-bar">
      <router-link :class="{ active: tab === 'home' }" to="/">
        <span class="icon">✎</span>記一筆
      </router-link>
      <router-link :class="{ active: tab === 'list' }" to="/list">
        <span class="icon">☰</span>明細
      </router-link>
      <router-link :class="{ active: tab === 'summary' }" to="/summary">
        <span class="icon">▣</span>月報
      </router-link>
      <router-link :class="{ active: tab === 'settings' }" to="/settings">
        <span class="icon">⚙</span>設定
      </router-link>
    </nav>
  </div>
</template>
