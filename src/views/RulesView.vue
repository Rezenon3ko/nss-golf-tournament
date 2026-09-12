<script setup>
import { ref } from 'vue'
import { mdiChevronDown, mdiChevronUp } from '@mdi/js'
import BaseIcon from '@/components/BaseIcon.vue'

const openIndex = ref(0)

const sections = [
  {
    title: '一、参赛及分组',
    items: [
      '本次比赛共 16 名参赛选手。',
      '按历史最佳成绩分为 4 个档次（每档 4 人）。',
      '比赛分为 A、B、C、D 四个小组，每组 4 人。',
      '每个小组必须包含 1 名 1档、1 名 2档、1 名 3档、1 名 4档选手。',
      '各档选手通过随机抽签分配至四个小组。',
    ],
  },
  {
    title: '二、小组赛',
    items: [
      '采用随机 9 洞模式，每场三局两胜（BO3）。',
      '单局胜者得 2 分，负者得 1 分。',
      '每名选手进行 3 场比赛，每个小组共 6 场。',
      '原则上每周 1 场，DDL 由主办方统一确定并提前公布。',
      '无正当理由超 DDL 未赛：责任方直接负场；双方均无理由可判双方负或另行处理。',
      '小组排名：积分 → 相互战绩 → 净胜局数 → 净胜杆数 → 主办方随机抽签。',
    ],
  },
  {
    title: '三、淘汰赛对阵',
    items: [
      '小组赛每组前 2 名晋级，共 8 人。',
      '上半区：A组第1 VS B组第2、C组第1 VS D组第2。',
      '下半区：A组第2 VS B组第1、C组第2 VS D组第1。',
      '上下半区胜者分别进行半决赛，最终胜者会师总决赛。',
    ],
  },
  {
    title: '四、淘汰赛比赛规则',
    items: [
      '淘汰赛采用随机 9 洞模式，每场五局三胜（BO5）。',
      '率先取得 3 局胜利的选手获胜并晋级下一轮。',
      '淘汰赛阶段不进行积分计算，以胜负确定晋级。',
      '原则上每周 1 场，每轮 DDL 由主办方统一公布。',
      '逾期未赛处理方式与小组赛一致。',
    ],
  },
  {
    title: '五、平局及突然死亡（SD）',
    items: [
      '单局 9 洞结束后比分相同，进入突然死亡（SD）。',
      'SD 不延续原 9 洞，而是重新开始一局新的随机 9 洞。',
      '每洞结束后比较双方该洞成绩，出现一方领先则立即结束，该方获得本局胜利。',
      '持续进行直至某一洞出现明确领先的一方。',
    ],
  },
  {
    title: '六、掉线及异常情况处理',
    items: [
      '掉线时应保留比赛画面，将截图或录屏发送至比赛群。',
      '掉线前已完成的洞数继续有效，重新开始一局同类型比赛，从第 1 洞进行剩余洞数。',
      '重赛成绩与掉线前成绩合并计算，已完成的洞数不重复计算。',
      '示例：完成 5 洞后掉线，前 5 洞有效，重赛进行剩余 4 洞并合并。',
      '掉线发生在某一洞进行中，该洞不计入已完成洞数。',
      '每场结束后双方应提交清晰显示最终结果的结算画面截图。',
    ],
  },
  {
    title: '七、比赛流程',
    items: [
      '16 名选手 → 按历史最佳成绩分 4 档 → 随机抽签分组 → 小组赛 → 各组前 2 名晋级 → 四分之一决赛 → 半决赛 → 总决赛 → 决出冠军。',
    ],
  },
  {
    title: '八、比赛纪律',
    items: [
      '所有参赛选手应遵守比赛规则及主办方安排。',
      '不得使用外挂、作弊程序或其他影响公平性的手段。',
      '按安排及时完成比赛，不得无故弃赛或拖延。',
      '发生争议时保留截图、录屏等证据并及时提出，由主办方最终裁定。',
    ],
  },
  {
    title: '九、成绩记录',
    items: [
      '掉线时需提供掉线画面截图或录屏。',
      '每场结束后双方需将最终结果截图发送至比赛群。',
      'DDL 由主办方公布并根据完成情况进行逾期判定。',
      '比赛相关截图及录屏由主办方统一留存，作为成绩记录的一部分。',
    ],
  },
]
</script>

<template>
  <div class="mx-auto max-w-3xl px-4 py-6">
    <div class="mb-5">
      <h1 class="text-2xl font-bold">比赛规则</h1>
      <p class="text-sm text-[#5d5b54] dark:text-[#a0a0a0]">
        依据《NSS_鬼吃鱼高尔夫锦标赛比赛规则》整理，正式条款以 PDF 原文为准。
      </p>
    </div>

    <div class="flex flex-col gap-2">
      <div
        v-for="(section, index) in sections"
        :key="section.title"
        class="overflow-hidden notion-card"
      >
        <button
          type="button"
          class="flex w-full items-center justify-between px-5 py-4 text-left font-semibold"
          @click="openIndex = openIndex === index ? -1 : index"
        >
          <span>{{ section.title }}</span>
          <BaseIcon :path="openIndex === index ? mdiChevronUp : mdiChevronDown" size="20" />
        </button>
        <ul
          v-if="openIndex === index"
          class="flex flex-col gap-2 border-t border-[#ede9e4] px-5 py-4 text-sm leading-relaxed text-[#37352f] dark:border-[#2e2e2e] dark:text-[#c7c7c7]"
        >
          <li v-for="(item, i) in section.items" :key="i" class="flex gap-2">
            <span class="text-[#1aae39]">•</span>
            <span>{{ item }}</span>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>
