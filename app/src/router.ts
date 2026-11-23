import { createRouter, createWebHashHistory } from 'vue-router'
import HomeView from './views/HomeView.vue'
import ListView from './views/ListView.vue'
import SummaryView from './views/SummaryView.vue'
import SettingsView from './views/SettingsView.vue'
import AddView from './views/AddView.vue'
import ReviewView from './views/ReviewView.vue'
import SetupView from './views/SetupView.vue'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'home', component: HomeView, meta: { tab: 'home' } },
    { path: '/list', name: 'list', component: ListView, meta: { tab: 'list' } },
    { path: '/summary', name: 'summary', component: SummaryView, meta: { tab: 'summary' } },
    { path: '/settings', name: 'settings', component: SettingsView, meta: { tab: 'settings' } },
    { path: '/add', name: 'add', component: AddView, meta: { tab: 'home' } },
    { path: '/review', name: 'review', component: ReviewView, meta: { tab: 'home' } },
    { path: '/setup', name: 'setup', component: SetupView, meta: { bare: true } },
  ],
})
