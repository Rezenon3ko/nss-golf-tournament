import {
  mdiViewDashboard,
  mdiAccountGroup,
  mdiGolf,
  mdiCalendarClock,
  mdiFolderImage,
  mdiExport,
  mdiEye,
  mdiLogout,
} from '@mdi/js'

export const menuAsideMain = [
  {
    to: '/admin',
    icon: mdiViewDashboard,
    label: '后台首页',
  },
  {
    to: '/admin/players',
    label: '选手与分组',
    icon: mdiAccountGroup,
  },
  {
    to: '/admin/matches',
    label: '赛果录入',
    icon: mdiGolf,
  },
  {
    to: '/admin/ddl',
    label: 'DDL 与逾期',
    icon: mdiCalendarClock,
  },
  {
    to: '/admin/evidence',
    label: '证据与日志',
    icon: mdiFolderImage,
  },
  {
    to: '/admin/export',
    label: '导出',
    icon: mdiExport,
  },
]

export const menuAsideBottom = [
  {
    to: '/',
    label: '查看前台',
    icon: mdiEye,
  },
  {
    label: '退出登录',
    icon: mdiLogout,
    isLogout: true,
  },
]
