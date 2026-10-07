import {
  mdiAccountGroup,
  mdiGolf,
  mdiCalendarClock,
  mdiHistory,
  mdiChartBoxOutline,
  mdiCalendar,
  mdiEye,
  mdiLogout,
} from '@mdi/js'

export const menuAsideMain = [
  {
    to: '/admin/seasons',
    icon: mdiCalendar,
    label: '赛季管理',
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
    to: '/admin/logs',
    label: '日志记录',
    icon: mdiHistory,
  },
  {
    to: '/admin/stats',
    label: '数据统计与导出',
    icon: mdiChartBoxOutline,
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
