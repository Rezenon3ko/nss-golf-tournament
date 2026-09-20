import { createRouter, createWebHashHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

// 按路由懒加载：首屏只加载入口 + 公共依赖，各页面在访问时再取
// （实测首屏 JS 从约 490 KB 降到约 372 KB，管理端页面完全按需下载）
const LayoutPublic = () => import('@/layouts/LayoutPublic.vue')
const LayoutAdmin = () => import('@/layouts/LayoutAdmin.vue')
const HomeView = () => import('@/views/HomeView.vue')
const GroupsView = () => import('@/views/GroupsView.vue')
const StandingsView = () => import('@/views/StandingsView.vue')
const BracketView = () => import('@/views/BracketView.vue')
const PlayersView = () => import('@/views/PlayersView.vue')
const PlayerProfileView = () => import('@/views/PlayerProfileView.vue')
const RulesView = () => import('@/views/RulesView.vue')
const LoginView = () => import('@/views/LoginView.vue')
const AdminView = () => import('@/views/AdminView.vue')
const AdminPlayersView = () => import('@/views/AdminPlayersView.vue')
const AdminMatchesView = () => import('@/views/AdminMatchesView.vue')
const AdminDdlView = () => import('@/views/AdminDdlView.vue')
const AdminEvidenceView = () => import('@/views/AdminEvidenceView.vue')
const AdminExportView = () => import('@/views/AdminExportView.vue')
const ErrorView = () => import('@/views/ErrorView.vue')

const routes = [
  {
    meta: {
      title: '主办方登录',
    },
    path: '/login',
    name: 'login',
    component: LoginView,
  },
  {
    path: '/',
    component: LayoutPublic,
    meta: { title: '首页' },
    children: [
      {
        path: '',
        name: 'home',
        component: HomeView,
      },
      {
        path: 'groups',
        name: 'groups',
        component: GroupsView,
        meta: { title: '小组赛' },
      },
      {
        path: 'standings',
        name: 'standings',
        component: StandingsView,
        meta: { title: '积分榜' },
      },
      {
        path: 'bracket',
        name: 'bracket',
        component: BracketView,
        meta: { title: '淘汰赛' },
      },
      {
        path: 'players',
        name: 'players',
        component: PlayersView,
        meta: { title: '选手' },
      },
      {
        path: 'players/:id',
        name: 'player',
        component: PlayerProfileView,
        meta: { title: '选手档案' },
      },
      {
        path: 'rules',
        name: 'rules',
        component: RulesView,
        meta: { title: '规则' },
      },
    ],
  },
  {
    path: '/admin',
    component: LayoutAdmin,
    meta: { requiresAdmin: true, title: '主办方后台' },
    children: [
      {
        path: '',
        name: 'admin',
        component: AdminView,
        meta: { title: '主办方后台' },
      },
      {
        path: 'players',
        name: 'admin-players',
        component: AdminPlayersView,
        meta: { title: '选手与分组' },
      },
      {
        path: 'matches',
        name: 'admin-matches',
        component: AdminMatchesView,
        meta: { title: '赛果录入' },
      },
      {
        path: 'ddl',
        name: 'admin-ddl',
        component: AdminDdlView,
        meta: { title: 'DDL 与逾期' },
      },
      {
        path: 'evidence',
        name: 'admin-evidence',
        component: AdminEvidenceView,
        meta: { title: '证据与日志' },
      },
      {
        path: 'export',
        name: 'admin-export',
        component: AdminExportView,
        meta: { title: '数据导出' },
      },
    ],
  },
  {
    meta: {
      title: '页面不存在',
    },
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: ErrorView,
  },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
  scrollBehavior(to, from, savedPosition) {
    return savedPosition || { top: 0 }
  },
})

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  if (!auth.initialized) {
    await auth.init()
  }
  if (to.meta.requiresAdmin && !auth.isAdmin) {
    return { name: 'login', query: { next: to.fullPath } }
  }
  if (to.name === 'login' && auth.isAdmin) {
    return { name: 'admin' }
  }
  return true
})

export default router
