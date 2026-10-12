// SPDX-License-Identifier: MPL-2.0

const status = document.querySelector('#connection-state')
const toolList = document.querySelector('#tools-list')
const form = document.querySelector('#draft-form')
const nameField = document.querySelector('#draft-name')
const submit = document.querySelector('#create-draft')
const mockFeedback = document.querySelector('#mock-feedback')
let host = null
let busy = false

window.addEventListener('lumi:mock-toast', (event) => {
  mockFeedback.textContent = String(event.detail.message)
})

async function start() {
  try {
    host = await window.lumi.ready()
    await window.lumi.context.get()
    const tools = await window.lumi.tools.list()
    const saved = await window.lumi.storage.get('draft-name')
    if (typeof saved === 'string') nameField.value = saved
    status.textContent = `${host.mode === 'mock' ? '本地模拟环境 · 不操作真实数据' : '已连接 Lumi'} · ${host.lumiVersion}`
    submit.disabled = !tools.some((tool) => tool.name === 'Lumi.create_capability_draft')
    for (const tool of tools) {
      const item = document.createElement('li')
      const title = document.createElement('strong')
      const description = document.createElement('p')
      title.textContent = tool.name
      description.textContent = tool.description
      item.append(title, description)
      toolList.append(item)
    }
    if (!tools.length) {
      const item = document.createElement('li')
      item.textContent = '暂无可用工具。'
      toolList.append(item)
    }
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : '无法连接 Lumi'
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault()
  if (busy || submit.disabled) return
  const name = nameField.value.trim()
  if (!/^[A-Za-z][A-Za-z0-9._-]{0,63}$/.test(name)) {
    nameField.setAttribute('aria-invalid', 'true')
    nameField.focus()
    await window.lumi.toast.show('名称须以英文字母开头，最多 64 个英文、数字、点、下划线或短横线。', 'error')
    return
  }
  busy = true
  submit.disabled = true
  submit.textContent = '创建中…'
  try {
    await window.lumi.tools.call('Lumi.create_capability_draft', { kind: 'terminal', name })
    await window.lumi.storage.set('draft-name', name)
    await window.lumi.toast.show(
      host.mode === 'mock' ? '模拟完成，未写入 Lumi。' : '能力草稿已创建，请在 Lumi 中审阅。',
      'success',
    )
  } catch (error) {
    await window.lumi.toast.show(error instanceof Error ? error.message : '操作失败，请重试。', 'error')
  } finally {
    busy = false
    submit.disabled = false
    submit.textContent = '创建草稿'
  }
})
nameField.addEventListener('input', () => nameField.removeAttribute('aria-invalid'))
void start()
