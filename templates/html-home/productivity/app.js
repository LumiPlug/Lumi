// SPDX-License-Identifier: MPL-2.0

const preset = window.lumiPreset
const $ = (id) => document.getElementById(id)
let connected = false
let busy = false
let saving = false
let reading = false
let visible = true
let timer = null
let tools = []
let todos = []
let bindings = {}
let tasks = []
let workflow = preset.workflows[0]
let selectedTask = null
let resultEpoch = 0
let dataFresh = false
const statuses = {
  running: '运行中',
  stopping: '正在停止',
  completed: '已完成',
  failed: '失败',
  cancelled: '已停止',
  timed_out: '超时',
  interrupted: '已中断',
}

function node(tag, text, className) {
  const element = document.createElement(tag)
  if (text !== undefined) element.textContent = text
  if (className) element.className = className
  return element
}
function errorText(error) {
  return error instanceof Error ? error.message : '操作未完成，请重试。'
}
async function toast(message, tone = 'info') {
  try {
    await window.lumi.toast.show(message, tone)
  } catch {
    /* The persistent connection status provides recovery. */
  }
}
function invalid(field, message) {
  field.setAttribute('aria-invalid', 'true')
  const help = document.getElementById(field.getAttribute('aria-describedby'))
  if (help) {
    if (!help.dataset.original) help.dataset.original = help.textContent
    help.textContent = message
  }
  field.focus()
  void toast(message, 'error')
}
function clearInvalid(field) {
  field.removeAttribute('aria-invalid')
  const help = document.getElementById(field.getAttribute('aria-describedby'))
  if (help?.dataset.original) help.textContent = help.dataset.original
}
function lock() {
  $('run').disabled =
    !connected ||
    busy ||
    reading ||
    saving ||
    !dataFresh ||
    !tools.some((tool) => tool.name === $('tool-select').value)
  $('run').textContent = busy ? '运行中…' : '运行工作流'
  $('refresh').disabled = busy || reading || saving
  $('refresh').textContent = reading ? '刷新中…' : '刷新工具与记录'
  $('tool-select').disabled = !connected || busy || reading || saving
  for (const button of $('workflow-choices').querySelectorAll('button'))
    button.disabled = busy || reading || saving
  for (const input of $('parameters').querySelectorAll('input, select, textarea'))
    input.disabled = busy || reading
  $('todo-input').disabled = !connected || saving
  $('add-todo').disabled = !connected || saving
  for (const input of $('todo-list').querySelectorAll('input, button'))
    input.disabled = saving || !connected
}
function renderTodos() {
  $('todo-list').replaceChildren()
  $('todo-count').textContent =
    `${todos.filter((todo) => todo.done).length} / ${todos.length} 已完成`
  if (!todos.length) $('todo-list').append(node('li', '还没有待办，添加一件要推进的事。', 'help'))
  for (const todo of todos) {
    const row = node('li')
    const label = node('label', undefined, todo.done ? 'done' : '')
    const checkbox = node('input')
    checkbox.type = 'checkbox'
    checkbox.checked = todo.done
    checkbox.addEventListener('change', () => {
      void saveTodos(
        todos.map((item) => (item.id === todo.id ? { ...item, done: checkbox.checked } : item)),
      )
    })
    label.append(checkbox, node('span', todo.text))
    const remove = node('button', '移除')
    remove.type = 'button'
    remove.setAttribute('aria-label', `移除待办：${todo.text}`)
    remove.addEventListener(
      'click',
      () => void saveTodos(todos.filter((item) => item.id !== todo.id)),
    )
    row.append(label, remove)
    $('todo-list').append(row)
  }
  lock()
}
async function saveTodos(next) {
  if (!connected || saving) return false
  saving = true
  lock()
  try {
    await window.lumi.storage.set('efficiency.todos', next)
    todos = next
    renderTodos()
    await toast('待办已保存。', 'success')
    return true
  } catch (error) {
    renderTodos()
    await toast(errorText(error), 'error')
    return false
  } finally {
    saving = false
    lock()
  }
}

function renderWorkflow() {
  $('selected-title').textContent = workflow.title
  $('selected-description').textContent = workflow.description
  for (const button of $('workflow-choices').children)
    button.setAttribute('aria-pressed', String(button.dataset.id === workflow.id))
  const select = $('tool-select')
  select.replaceChildren()
  const empty = node('option', tools.length ? '选择一个已授权工具' : '暂无已授权工具，请先配置')
  empty.value = ''
  select.append(empty)
  for (const tool of tools) {
    const option = node('option', tool.name)
    option.value = tool.name
    select.append(option)
  }
  const saved = bindings[workflow.id]
  select.value = tools.some((tool) => tool.name === saved) ? saved : ''
  $('tool-help').textContent =
    saved && !select.value
      ? '原关联工具已不可用，请在「工具」中确认启用状态，刷新后重新选择。'
      : '只列出已授权的工具操作。选择后保存关联，点击运行才会执行。'
  $('setup-guide').open = !tools.length
  renderParameters()
  lock()
}
function renderParameters() {
  const tool = tools.find((item) => item.name === $('tool-select').value)
  $('parameters').replaceChildren()
  $('tool-description').textContent = tool?.description ?? ''
  if (!tool) return
  const schema = tool.inputSchema
  const properties = schema.properties ?? {}
  const simple =
    schema.type === 'object' &&
    !schema.oneOf &&
    !schema.anyOf &&
    !schema.allOf &&
    schema.additionalProperties === false
  if (!simple) {
    const label = node('label', '运行参数（JSON 对象）')
    label.htmlFor = 'args-json'
    const input = node('textarea')
    input.id = 'args-json'
    input.value = '{}'
    input.dataset.json = 'true'
    input.setAttribute('aria-describedby', 'args-help')
    input.addEventListener('input', () => clearInvalid(input))
    const help = node(
      'p',
      '按下方工具 Schema 填写参数。参数仅用于本次运行，不保存到工作台。',
      'help',
    )
    help.id = 'args-help'
    const details = node('details')
    details.append(node('summary', '查看参数 Schema'), node('pre', JSON.stringify(schema, null, 2)))
    $('parameters').append(label, input, help, details)
    return
  }
  if (!Object.keys(properties).length)
    $('parameters').append(node('p', '此操作无需填写参数。', 'help'))
  Object.entries(properties).forEach(([key, spec], index) => {
    const required = schema.required?.includes(key)
    const label = node('label', `${spec.title || key}${required ? '（必填）' : '（可选）'}`)
    const id = `parameter-${index}`
    label.htmlFor = id
    let input
    if (Array.isArray(spec.enum)) {
      input = node('select')
      const empty = node('option', '请选择')
      empty.value = ''
      input.append(empty)
      spec.enum.forEach((value, enumIndex) => {
        const option = node('option', String(value))
        option.value = String(enumIndex)
        input.append(option)
      })
      input.dataset.enum = JSON.stringify(spec.enum)
    } else if (spec.type === 'boolean') {
      input = node('select')
      for (const [value, text] of [
        ['', '请选择'],
        ['true', '是'],
        ['false', '否'],
      ]) {
        const option = node('option', text)
        option.value = value
        input.append(option)
      }
    } else if (spec.type === 'number' || spec.type === 'integer') {
      input = node('input')
      input.type = 'number'
      input.step = spec.type === 'integer' ? '1' : 'any'
      if (typeof spec.minimum === 'number') input.min = String(spec.minimum)
      if (typeof spec.maximum === 'number') input.max = String(spec.maximum)
    } else {
      input = node('textarea')
      input.rows = 2
      if (spec.type !== 'string') input.dataset.json = 'true'
      if (typeof spec.maxLength === 'number') input.maxLength = spec.maxLength
      if (typeof spec.minLength === 'number') input.minLength = spec.minLength
    }
    input.id = id
    input.dataset.key = key
    input.dataset.type = spec.type ?? 'json'
    input.required = Boolean(required)
    input.setAttribute('aria-describedby', `${id}-help`)
    input.addEventListener('input', () => clearInvalid(input))
    const help = node(
      'p',
      spec.description ||
        (input.dataset.json ? '输入 JSON 值。' : '按工具要求填写本次运行的参数。'),
      'help',
    )
    help.id = `${id}-help`
    $('parameters').append(label, input, help)
  })
}
function readArguments() {
  const args = {}
  for (const field of $('parameters').querySelectorAll('input, select, textarea')) {
    if (!field.value && !field.required && field.id !== 'args-json') continue
    if (!field.checkValidity()) {
      invalid(field, '请填写符合要求的运行参数。')
      return null
    }
    let value = field.value
    try {
      if (field.dataset.enum) value = JSON.parse(field.dataset.enum)[Number(value)]
      else if (field.dataset.json || field.dataset.type === 'boolean') value = JSON.parse(value)
      else if (['number', 'integer'].includes(field.dataset.type)) value = Number(value)
      if (field.id === 'args-json') {
        if (!value || typeof value !== 'object' || Array.isArray(value))
          throw new Error('object required')
        return value
      }
      Object.defineProperty(args, field.dataset.key, { value, enumerable: true })
    } catch {
      invalid(field, '参数格式无效，请按要求填写 JSON。')
      return null
    }
  }
  return args
}

function renderTasks() {
  $('task-list').replaceChildren()
  $('history-state').textContent = tasks.length
    ? '显示最近 8 条记录。点击记录查看实际结果与日志。'
    : '还没有运行记录。配置并运行一个工作流后，结果会显示在这里。'
  for (const task of tasks.slice(0, 8)) {
    const item = node('li')
    const button = node('button')
    button.type = 'button'
    button.setAttribute('aria-pressed', String(selectedTask === task.id))
    button.append(
      node('span', `${task.capabilityName} · ${task.operation}`),
      node(
        'small',
        `${statuses[task.status] || task.status} · ${new Date(task.startedAt).toLocaleString('zh-CN')}`,
      ),
    )
    button.addEventListener('click', () => void showTask(task.id))
    item.append(button)
    $('task-list').append(item)
  }
}
async function showTask(id, quiet = false) {
  selectedTask = id
  const epoch = ++resultEpoch
  renderTasks()
  if (!quiet) $('result').textContent = '正在读取实际运行结果…'
  try {
    const { task } = await window.lumi.tools.call('Lumi.get_task', { id })
    if (epoch !== resultEpoch) return
    const parts = [
      `${task.capabilityName} · ${task.operation}`,
      `状态：${statuses[task.status] || task.status}`,
    ]
    if (task.error) parts.push(`错误：${task.error}`)
    if (task.result !== null && task.result !== undefined)
      parts.push(
        typeof task.result === 'string' ? task.result : JSON.stringify(task.result, null, 2),
      )
    if (task.stdout) parts.push(task.stdout)
    if (task.stderr) parts.push(task.stderr)
    if (task.truncated) parts.push('结果或日志已按宿主限额裁剪。')
    if (parts.length === 2)
      parts.push(
        task.status === 'running' || task.status === 'stopping'
          ? '任务尚在运行，完成后自动刷新。'
          : '此任务没有返回内容。',
      )
    $('result').textContent = parts.join('\n\n')
  } catch (error) {
    if (epoch !== resultEpoch) return
    $('result').textContent = '运行结果暂不可用，请刷新后重试。'
    if (!quiet) await toast(errorText(error), 'error')
  }
}
function schedule() {
  window.clearTimeout(timer)
  if (
    connected &&
    dataFresh &&
    visible &&
    !document.hidden &&
    tasks.some((task) => ['running', 'stopping'].includes(task.status))
  )
    timer = window.setTimeout(() => void refresh(true), 2000)
}
async function refresh(quiet = false) {
  if (!connected || reading || busy || saving) return
  reading = true
  lock()
  try {
    const [available, history] = await Promise.all([
      window.lumi.tools.list(),
      window.lumi.tools.call('Lumi.list_tasks', {}),
    ])
    const nextTools = available.filter((tool) => !tool.name.startsWith('Lumi.'))
    const catalogChanged = JSON.stringify(tools) !== JSON.stringify(nextTools)
    tools = nextTools
    tasks = history.tasks
    dataFresh = true
    $('connection-state').textContent = `已连接 Lumi · ${tools.length} 个已授权操作`
    if (!quiet || catalogChanged) renderWorkflow()
    renderTasks()
    if (selectedTask) await showTask(selectedTask, true)
    if (!quiet) await toast('工具与运行记录已刷新。', 'success')
  } catch (error) {
    $('connection-state').textContent = '暂时无法读取 Lumi 数据，请确认本地服务后刷新。'
    tools = []
    dataFresh = false
    renderWorkflow()
    if (!quiet) await toast(errorText(error), 'error')
  } finally {
    reading = false
    lock()
    schedule()
  }
}
async function start() {
  if (reading) return
  reading = true
  lock()
  try {
    const host = await window.lumi.ready()
    if (host.mode !== 'lumi') {
      $('connection-state').textContent =
        '当前为本地布局预览。请在 Lumi 中应用此模板，连接真实工具和数据。'
      return
    }
    await window.lumi.context.get()
    const [savedTodos, savedBindings] = await Promise.all([
      window.lumi.storage.get('efficiency.todos'),
      window.lumi.storage.get('efficiency.bindings'),
    ])
    todos = Array.isArray(savedTodos)
      ? savedTodos
          .filter(
            (item) =>
              item &&
              typeof item.id === 'string' &&
              typeof item.text === 'string' &&
              typeof item.done === 'boolean',
          )
          .slice(0, 60)
      : []
    bindings =
      savedBindings && typeof savedBindings === 'object' && !Array.isArray(savedBindings)
        ? savedBindings
        : {}
    connected = true
    renderTodos()
    renderWorkflow()
  } catch (error) {
    $('connection-state').textContent = '工作台连接或数据读取失败，请确认 Lumi 服务后点击刷新。'
    await toast(errorText(error), 'error')
  } finally {
    reading = false
    lock()
  }
  if (connected) await refresh(true)
}

$('page-title').textContent = preset.title
$('introduction').textContent = preset.introduction
$('todo-title').textContent = preset.todoTitle
$('todo-input').placeholder = preset.todoPlaceholder
document.title = `${preset.label}工作台`
for (const item of preset.workflows) {
  const button = node('button', item.title)
  button.type = 'button'
  button.dataset.id = item.id
  button.addEventListener('click', () => {
    workflow = item
    renderWorkflow()
  })
  $('workflow-choices').append(button)
}
$('refresh').addEventListener('click', () => void (connected ? refresh() : start()))
async function addTodo(event) {
  event.preventDefault()
  if (!connected || saving) return
  const field = $('todo-input')
  const text = field.value.trim()
  if (!text) {
    invalid(field, '请先填写一件要做的事。')
    return
  }
  if (todos.length >= 60) {
    invalid(field, '最多保存 60 项待办，请先移除已完成的事项。')
    return
  }
  const saved = await saveTodos([...todos, { id: window.crypto.randomUUID(), text, done: false }])
  if (saved) {
    field.value = ''
    field.focus()
  }
}
$('add-todo').addEventListener('click', addTodo)
$('todo-form').addEventListener('submit', addTodo)
$('todo-input').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.isComposing) void addTodo(event)
})
$('todo-input').addEventListener('input', () => clearInvalid($('todo-input')))
$('tool-select').addEventListener('change', async () => {
  if (!connected || saving) return
  const next = { ...bindings, [workflow.id]: $('tool-select').value }
  saving = true
  lock()
  try {
    await window.lumi.storage.set('efficiency.bindings', next)
    bindings = next
    renderParameters()
    await toast('工作流关联已保存。', 'success')
  } catch (error) {
    renderWorkflow()
    await toast(errorText(error), 'error')
  } finally {
    saving = false
    lock()
  }
})
async function runWorkflow(event) {
  event.preventDefault()
  if ($('run').disabled || busy || saving) return
  const args = readArguments()
  if (args === null) return
  const name = $('tool-select').value
  const previousTasks = new Set(tasks.map((task) => task.id))
  let failed = false
  selectedTask = null
  resultEpoch += 1
  $('result').textContent = '正在执行所选工具…'
  busy = true
  lock()
  try {
    const result = await window.lumi.tools.call(name, args)
    if (typeof result?.taskId === 'string' && ['running', 'stopping'].includes(result.status)) {
      selectedTask = result.taskId
      await showTask(result.taskId)
      await toast('任务已提交，运行状态与结果可在下方查看。', 'success')
    } else {
      selectedTask = null
      resultEpoch += 1
      $('result').textContent =
        typeof result === 'string' ? result : JSON.stringify(result, null, 2)
      await toast('工作流已完成。', 'success')
    }
  } catch (error) {
    failed = true
    $('result').textContent = '本次调用未能完成，可在运行记录中查看实际状态。'
    const field = $('parameters').querySelector('input, textarea, select')
    if (error?.code === 'invalid_tool_arguments' && field) invalid(field, errorText(error))
    else await toast(errorText(error), 'error')
  } finally {
    busy = false
    lock()
    await refresh(true)
    const latest = tasks.find((task) => !previousTasks.has(task.id) && task.source === 'workbench')
    if ((failed || !selectedTask) && latest) await showTask(latest.id, true)
  }
}
$('run').addEventListener('click', runWorkflow)
$('run-form').addEventListener('submit', runWorkflow)
$('run-form').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.isComposing && event.target.tagName === 'INPUT')
    void runWorkflow(event)
})
document.addEventListener('visibilitychange', () => {
  if (document.hidden) window.clearTimeout(timer)
  else if (visible) void refresh(true)
})
const observer = new window.IntersectionObserver(([entry]) => {
  visible = entry.isIntersecting
  if (visible && connected) void refresh(true)
  else window.clearTimeout(timer)
})
observer.observe(document.body)
window.addEventListener('pagehide', () => {
  window.clearTimeout(timer)
  observer.disconnect()
})
renderTodos()
renderWorkflow()
void start()
