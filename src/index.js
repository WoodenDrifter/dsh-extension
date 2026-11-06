// dsh-extension：宿主机侧。
//
// 2.0 起这个包只剩浏览器端的「拓展」容器，宿主端不需要任何能力与路由，
// 但 bundle 仍然要求一个可 import 的宿主模块，所以保留这个空壳。
//
// 之前版本在这里实现的 bsk 进程管理（/__dsh-ext/bsk/*）已经迁到独立包 dsh-bsk-daemon。
export const name = 'dsh-extension'
export const inject = []

export function apply() {
  // 有意留空：容器只存在于浏览器侧
}
