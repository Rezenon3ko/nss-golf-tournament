import { supabase } from '@/lib/supabase'
import { USE_SUPABASE } from '@/config'

/**
 * 头像的裁剪、上传与地址解析。
 *
 * 云端模式：图片压缩后上传到 Supabase Storage（bucket: avatars），
 * 赛事数据里只保留公开 URL，从而避免整份 JSON 被十几张 base64 撑到几百 KB。
 * 本地模式（未配置 Supabase）：回退为 dataURL，随本机缓存保存，行为与以前一致。
 */

// bucket 名、裁剪尺寸、压缩质量与缓存时长都是本模块内部约定（仅此处使用）
const AVATAR_BUCKET = 'avatars'
const AVATAR_EDGE = 256
const AVATAR_QUALITY = 0.85
// 路径带时间戳，换头像即换 URL，因此可以放心设置长缓存（CDN 与浏览器都受益）
const AVATAR_CACHE_CONTROL = '31536000'

export function avatarStorageEnabled() {
  return Boolean(USE_SUPABASE && supabase?.storage)
}

// 居中裁剪为正方形并压缩成 JPEG Blob（浏览器环境）
export function fileToAvatarBlob(file, { edge = AVATAR_EDGE, quality = AVATAR_QUALITY } = {}) {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error('未选择文件'))
      return
    }
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('图片读取失败'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('图片解码失败'))
      img.onload = () => {
        const side = Math.min(img.width, img.height)
        const canvas = document.createElement('canvas')
        canvas.width = edge
        canvas.height = edge
        const ctx = canvas.getContext('2d')
        ctx.drawImage(
          img,
          (img.width - side) / 2,
          (img.height - side) / 2,
          side,
          side,
          0,
          0,
          edge,
          edge,
        )
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error('图片编码失败'))),
          'image/jpeg',
          quality,
        )
      }
      img.src = reader.result
    }
    reader.readAsDataURL(file)
  })
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('图片读取失败'))
    reader.onload = () => resolve(String(reader.result))
    reader.readAsDataURL(blob)
  })
}

// 把头像对象上传到 Storage，返回公开 URL；云端不可用时返回 null（调用方回退 dataURL）
export async function uploadAvatar(blob, { id } = {}) {
  if (!avatarStorageEnabled() || !blob) return null
  const path = avatarPath(id)
  const { error } = await supabase.storage.from(AVATAR_BUCKET).upload(path, blob, {
    contentType: blob.type || 'image/jpeg',
    cacheControl: AVATAR_CACHE_CONTROL,
    upsert: false,
  })
  if (error) throw new Error(error.message || '头像上传失败')
  const { data } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path)
  return data?.publicUrl || null
}

// 删除玩家时顺带清理对象；失败不阻塞主流程（最多留一个孤儿文件）
export async function removeAvatarByUrl(url) {
  const path = avatarPathFromUrl(url)
  if (!path || !avatarStorageEnabled()) return false
  const { error } = await supabase.storage.from(AVATAR_BUCKET).remove([path])
  return !error
}

function avatarPath(id) {
  const owner = String(id || 'player').replace(/[^a-zA-Z0-9_-]/g, '')
  return `${owner || 'player'}-${Date.now()}.jpg`
}

// 从公开 URL 反推对象路径；不是本 bucket 的 URL 返回 null（删除选手时用来清理对象）
export function avatarPathFromUrl(url) {
  const marker = `/storage/v1/object/public/${AVATAR_BUCKET}/`
  const text = String(url == null ? '' : url)
  const index = text.indexOf(marker)
  if (index === -1) return null
  const path = text.slice(index + marker.length).split('?')[0]
  return path || null
}
