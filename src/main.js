import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import { useFeedbackStore } from '@/stores/feedback'
import { useDarkModeStore } from '@/stores/darkMode'
import { siteName } from '@/config'

import './css/main.css'

// Init Pinia
const pinia = createPinia()

// Create Vue app
const app = createApp(App)

// 未捕获异常：至少留下可查的日志，并给用户一条提示（而不是白屏或静默失败）
const feedback = useFeedbackStore(pinia)
app.config.errorHandler = (err, instance, info) => {
  console.error('[app error]', info, err)
  feedback.error('页面出错了，请刷新后重试；若持续出现请把控制台信息反馈给主办方')
}

app.use(pinia).use(router).mount('#app')

// Dark mode
const darkModeStore = useDarkModeStore(pinia)
darkModeStore.init()

const defaultDocumentTitle = siteName

// Set document title from route meta
router.afterEach((to) => {
  document.title = to.meta?.title
    ? `${to.meta.title} — ${defaultDocumentTitle}`
    : defaultDocumentTitle
})
