@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package dev.forge.nativeapp.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.collectIsDraggedAsState
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.forge.nativeapp.*
import kotlinx.coroutines.launch

@Composable
fun ForgeScreen(state: ChatUiState, actions: ChatActions) {
    val drawer = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    var connectionDialog by rememberSaveable { mutableStateOf(false) }
    var modelDialog by rememberSaveable { mutableStateOf(false) }
    var confirmUncertain by remember { mutableStateOf(false) }
    val connected = state.connection == ConnectionPhase.Connected
    val locked = state.sending || state.busy

    ModalNavigationDrawer(drawerState = drawer, drawerContent = {
        ModalDrawerSheet(Modifier.widthIn(max = 340.dp)) {
            var search by rememberSaveable { mutableStateOf("") }
            Row(Modifier.fillMaxWidth().padding(20.dp), verticalAlignment = Alignment.CenterVertically) {
                BrandMark()
                Column(Modifier.padding(start = 12.dp)) {
                    Text("Forge", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                    Text("对话，随时继续", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            FilledTonalButton(onClick = { actions.newChat(); scope.launch { drawer.close() } },
                enabled = !locked, modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).height(48.dp)) {
                Icon(Icons.Default.Add, null); Spacer(Modifier.width(8.dp)); Text("新的对话")
            }
            OutlinedTextField(search, { search = it }, singleLine = true, placeholder = { Text("搜索会话") },
                leadingIcon = { Icon(Icons.Default.Search, null) },
                modifier = Modifier.fillMaxWidth().padding(16.dp), shape = RoundedCornerShape(14.dp))
            Text("最近对话", Modifier.padding(horizontal = 24.dp, vertical = 8.dp), style = MaterialTheme.typography.labelMedium)
            LazyColumn(Modifier.weight(1f)) {
                items(state.sessions.filter { it.title.contains(search, true) }, key = { it.id }) { session ->
                    NavigationDrawerItem(selected = state.selectedId == session.id,
                        label = { Column {
                            Text(session.title, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(session.model, style = MaterialTheme.typography.labelSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        } }, onClick = { if (!locked) { actions.selectSession(session.id); scope.launch { drawer.close() } } },
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 3.dp))
                }
                if (state.sessions.isEmpty()) item {
                    Text(if (connected) "还没有对话，开始聊点什么吧。" else "连接 Core 后读取服务器会话。",
                        Modifier.padding(24.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            TextButton(onClick = { connectionDialog = true }, modifier = Modifier.fillMaxWidth().height(56.dp)) {
                Icon(Icons.Default.Settings, null); Spacer(Modifier.width(8.dp)); Text("服务器连接")
            }
        }
    }) {
        Scaffold(containerColor = MaterialTheme.colorScheme.background,
            topBar = {
                Column {
                    TopAppBar(title = { Column {
                        Text(if (state.selectedId == null) "Forge" else state.title, maxLines = 1,
                            overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                        Text(if (connected) "●  Core 已连接" else "○  ${phaseName(state.connection)}",
                            style = MaterialTheme.typography.labelSmall,
                            color = if (connected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)
                    } }, navigationIcon = { IconButton(onClick = { scope.launch { drawer.open() } }) { Icon(Icons.Default.Menu, "会话列表") } },
                        actions = {
                            IconButton(onClick = actions::newChat, enabled = !locked, modifier = Modifier.testTag("new-chat")) { Icon(Icons.Default.Add, "新对话") }
                            IconButton(onClick = { connectionDialog = true }, modifier = Modifier.testTag("settings")) { Icon(Icons.Default.Settings, "连接设置") }
                        }, colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background))
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                }
            },
            bottomBar = {
                Column(Modifier.fillMaxWidth().navigationBarsPadding().imePadding().background(MaterialTheme.colorScheme.background)) {
                    if (state.run != null) {
                        Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                            CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp)
                            Text(if (state.approvals.isEmpty()) "Core 正在处理 · 可以先写下一条消息" else "等待你的工具审批",
                                Modifier.padding(start = 8.dp), style = MaterialTheme.typography.labelMedium)
                        }
                    }
                    Composer(state, actions, onModels = { modelDialog = true })
                }
            }
        ) { padding ->
            Column(Modifier.fillMaxSize().padding(padding)) {
                if (state.connection == ConnectionPhase.Reconnecting || state.connection == ConnectionPhase.Connecting) {
                    LinearProgressIndicator(Modifier.fillMaxWidth())
                    Text(state.connectionDetail, Modifier.padding(horizontal = 20.dp, vertical = 8.dp), style = MaterialTheme.typography.labelMedium)
                }
                if (state.error != null) {
                    Surface(color = MaterialTheme.colorScheme.errorContainer) {
                        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
                            Text(state.error, color = MaterialTheme.colorScheme.onErrorContainer, style = MaterialTheme.typography.bodySmall)
                            Row {
                                TextButton(onClick = actions::refresh) { Text("刷新状态") }
                                TextButton(onClick = actions::dismissError) { Text("收起提示") }
                            }
                        }
                    }
                }
                if (state.uncertain && !locked) {
                    Surface(color = MaterialTheme.colorScheme.tertiaryContainer) {
                        Column(Modifier.padding(16.dp)) {
                            Text("上次操作结果未确认。先刷新历史和任务状态，避免重复发送。", style = MaterialTheme.typography.bodySmall)
                            Row {
                                TextButton(onClick = actions::refresh) { Text("刷新检查") }
                                TextButton(onClick = { confirmUncertain = true }, enabled = connected) { Text("我已检查") }
                            }
                        }
                    }
                }
                if (state.loading && state.messages.isEmpty()) {
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                } else if (state.messages.isEmpty() && state.run == null && state.approvals.isEmpty()) {
                    Welcome(connected, onConnect = { connectionDialog = true }, onPrompt = actions::updateDraft)
                } else {
                    Conversation(state, actions, Modifier.weight(1f))
                }
            }
        }
    }
    if (connectionDialog) ConnectionDialog(state, actions) { connectionDialog = false }
    if (modelDialog) ModelDialog(state, onSelect = { actions.selectModel(it); modelDialog = false }, onDismiss = { modelDialog = false })
    if (confirmUncertain) AlertDialog(onDismissRequest = { confirmUncertain = false },
        title = { Text("确认已经检查服务器状态？") },
        text = { Text("如果消息已送达，请先清空重复草稿。解锁只恢复操作按钮，不会自动重发或再次审批。") },
        confirmButton = { TextButton(onClick = { actions.acknowledgeUncertain(); confirmUncertain = false }) { Text("确认，解锁操作") } },
        dismissButton = { TextButton(onClick = { confirmUncertain = false }) { Text("返回检查") } })
}

@Composable private fun BrandMark() {
    Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.primaryContainer) {
        Box(Modifier.size(52.dp), contentAlignment = Alignment.Center) {
            Text("F", fontWeight = FontWeight.Black, fontSize = 30.sp, color = MaterialTheme.colorScheme.primary)
        }
    }
}

@Composable private fun Welcome(connected: Boolean, onConnect: () -> Unit, onPrompt: (String) -> Unit) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(28.dp), verticalArrangement = Arrangement.Center) {
        BrandMark()
        Spacer(Modifier.height(24.dp))
        Text("把想法，\n聊成下一步。", fontSize = 30.sp, lineHeight = 42.sp, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(12.dp))
        Text("原生体验，专注对话。\n连接你的 Forge Core，继续思考与创造。", lineHeight = 24.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(28.dp))
        if (!connected) {
            Button(onClick = onConnect, modifier = Modifier.heightIn(min = 48.dp)) { Text("连接 Forge Core") }
        } else {
            listOf("一起梳理一个想法" to "我有一个想法，想和你一起梳理。请先问我几个关键问题。",
                "把复杂问题讲清楚" to "帮我理解一个复杂问题。先和我确认目标，再逐步讲解。",
                "回到项目，继续推进" to "请先只读查看当前项目，概括进展，并建议下一步。不要修改文件。").forEach { (label, prompt) ->
                OutlinedCard(onClick = { onPrompt(prompt) }, modifier = Modifier.fillMaxWidth().padding(vertical = 5.dp)) {
                    Row(Modifier.padding(16.dp).fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text(label); Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null)
                    }
                }
            }
        }
        Spacer(Modifier.height(20.dp))
        Text("模型、工具与会话留在你的服务器", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable private fun Composer(state: ChatUiState, actions: ChatActions, onModels: () -> Unit) {
    var permissions by remember { mutableStateOf(false) }
    val connected = state.connection == ConnectionPhase.Connected
    val locked = state.busy || state.sending || state.uncertain
    Surface(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
        shape = RoundedCornerShape(22.dp), color = MaterialTheme.colorScheme.surface, tonalElevation = 1.dp) {
        Column(Modifier.padding(8.dp)) {
            OutlinedTextField(value = state.draft, onValueChange = actions::updateDraft,
                placeholder = { Text(if (state.run == null) "聊点什么，或描述一个任务…" else "写下下一条消息…") },
                modifier = Modifier.fillMaxWidth().testTag("composer"), minLines = 1, maxLines = 6,
                colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = MaterialTheme.colorScheme.surface,
                    unfocusedBorderColor = MaterialTheme.colorScheme.surface), shape = RoundedCornerShape(14.dp))
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = onModels, enabled = !state.sending, modifier = Modifier.weight(1f)) {
                    Text(state.selectedModel.ifEmpty { "服务器默认模型" }, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.labelMedium)
                    Icon(Icons.Default.ArrowDropDown, null, Modifier.size(18.dp))
                }
                Box {
                    TextButton(onClick = { permissions = true }, enabled = !state.sending) {
                        Icon(Icons.Default.Lock, null, Modifier.size(14.dp)); Spacer(Modifier.width(4.dp))
                        Text(if (state.permission == "readonly") "只读" else "需审批", style = MaterialTheme.typography.labelMedium)
                    }
                    DropdownMenu(expanded = permissions, onDismissRequest = { permissions = false }) {
                        DropdownMenuItem(text = { Text("只读对话 · 不修改文件") }, onClick = { actions.setPermission("readonly"); permissions = false })
                        DropdownMenuItem(text = { Text("工作区 · 工具操作需审批") }, onClick = { actions.setPermission("workspace"); permissions = false })
                    }
                }
                if (state.run != null) {
                    FilledTonalButton(onClick = actions::stop, enabled = connected && !locked, modifier = Modifier.height(48.dp).testTag("stop"),
                        contentPadding = PaddingValues(horizontal = 16.dp)) { Text("停止") }
                } else {
                    FilledIconButton(onClick = actions::send, enabled = connected && !locked && !state.loading && state.draft.isNotBlank(),
                        modifier = Modifier.size(48.dp).testTag("send")) {
                        if (state.sending) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                        else Icon(Icons.AutoMirrored.Filled.Send, "发送消息")
                    }
                }
            }
        }
    }
}

@Composable private fun Conversation(state: ChatUiState, actions: ChatActions, modifier: Modifier) {
    val list = rememberLazyListState()
    val scope = rememberCoroutineScope()
    var follow by remember(state.selectedId) { mutableStateOf(true) }
    val nearBottom by remember { derivedStateOf { !list.canScrollForward } }
    val dragged by list.interactionSource.collectIsDraggedAsState()
    LaunchedEffect(dragged) { if (dragged) follow = false }
    LaunchedEffect(nearBottom) { if (nearBottom && !dragged) follow = true }
    val lastIndex = state.messages.size + state.approvals.size + if (state.hasEarlier) 1 else 0
    LaunchedEffect(state.selectedId, state.messages.lastOrNull(), lastIndex) {
        if (follow) list.scrollToItem(lastIndex)
    }
    Box(modifier.fillMaxWidth()) {
        LazyColumn(state = list, modifier = Modifier.fillMaxSize().testTag("transcript"),
            contentPadding = PaddingValues(horizontal = 20.dp, vertical = 20.dp), verticalArrangement = Arrangement.spacedBy(22.dp)) {
            if (state.hasEarlier) item(key = "earlier") {
                TextButton(onClick = { follow = false; actions.loadEarlier() }, enabled = !state.loadingEarlier,
                    modifier = Modifier.fillMaxWidth().testTag("earlier")) { Text(if (state.loadingEarlier) "正在读取…" else "加载更早的消息") }
            }
            items(state.messages, key = { it.key }) { message -> MessageBubble(message) }
            items(state.approvals, key = { "approval-${it.id}" }) { approval ->
                ApprovalCard(approval, enabled = state.connection == ConnectionPhase.Connected && !state.busy && !state.uncertain,
                    onAnswer = { actions.answerApproval(approval.id, it) })
            }
            item(key = "tail") { Spacer(Modifier.height(4.dp)) }
        }
        if (!nearBottom) SmallFloatingActionButton(onClick = { follow = true; scope.launch { list.animateScrollToItem((list.layoutInfo.totalItemsCount - 1).coerceAtLeast(0)) } },
            modifier = Modifier.align(Alignment.BottomEnd).padding(16.dp)) { Icon(Icons.Default.KeyboardArrowDown, "回到最新消息") }
    }
}

@Composable private fun MessageBubble(message: ChatMessage) {
    val clipboard = LocalClipboardManager.current
    val user = message.role == "user"
    var reasoning by remember(message.key) { mutableStateOf(false) }
    var tool by remember(message.key) { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth(), horizontalAlignment = if (user) Alignment.End else Alignment.Start) {
        if (!user) Row(verticalAlignment = Alignment.CenterVertically) {
            Text(if (message.role == "tool") "工具" else "FORGE", style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
            if (message.isStreaming) Text("  ·  正在回复", style = MaterialTheme.typography.labelSmall)
        }
        Spacer(Modifier.height(8.dp))
        if (message.reasoning.isNotEmpty()) {
            TextButton(onClick = { reasoning = !reasoning }) { Text(if (reasoning) "收起思考" else "查看思考过程") }
            if (reasoning) Surface(color = MaterialTheme.colorScheme.surfaceVariant, shape = MaterialTheme.shapes.medium) {
                Box(Modifier.padding(14.dp)) { MessageContent(message.reasoning, false) }
            }
        }
        if (message.role == "tool") {
            OutlinedCard(Modifier.fillMaxWidth()) {
                TextButton(onClick = { tool = !tool }, modifier = Modifier.fillMaxWidth()) { Text("${message.toolName}  ${if (tool) "−" else "+"}") }
                if (tool) Box(Modifier.padding(14.dp)) { MessageContent(message.text, false) }
            }
        } else {
            if (message.text.isNotEmpty()) Surface(shape = RoundedCornerShape(18.dp),
                color = if (user) MaterialTheme.colorScheme.surfaceVariant else MaterialTheme.colorScheme.background) {
                Box(if (user) Modifier.padding(horizontal = 16.dp, vertical = 12.dp) else Modifier) { MessageContent(message.text, !user) }
            }
            if (message.imageCount > 0) Text("附带 ${message.imageCount} 张图片 · 请在 Web 端查看", style = MaterialTheme.typography.labelSmall)
            if (message.toolName.isNotEmpty()) Text("调用工具：${message.toolName}", style = MaterialTheme.typography.labelSmall)
        }
        if (message.text.isNotEmpty()) TextButton(onClick = { clipboard.setText(AnnotatedString(message.text)) }, contentPadding = PaddingValues(horizontal = 4.dp)) {
            Text("复制", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable private fun ApprovalCard(approval: Approval, enabled: Boolean, onAnswer: (Boolean) -> Unit) {
    Surface(color = MaterialTheme.colorScheme.tertiaryContainer, shape = MaterialTheme.shapes.large) {
        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("需要你的允许", fontWeight = FontWeight.SemiBold)
            Text(approval.toolName, style = MaterialTheme.typography.labelLarge)
            MessageContent(approval.description, false)
            if (approval.command.isNotEmpty()) MessageContent("```\n${approval.command}\n```")
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                TextButton(onClick = { onAnswer(false) }, enabled = enabled, modifier = Modifier.testTag("deny-approval")) { Text("拒绝") }
                Button(onClick = { onAnswer(true) }, enabled = enabled, modifier = Modifier.testTag("allow-approval")) { Text("允许这一次") }
            }
        }
    }
}

@Composable private fun ConnectionDialog(state: ChatUiState, actions: ChatActions, onDismiss: () -> Unit) {
    var url by rememberSaveable { mutableStateOf(state.serverUrl) }
    // Secrets intentionally never enter saved instance state, preferences or a data-class toString.
    var credential by remember { mutableStateOf("") }
    var pair by remember { mutableStateOf(false) }
    AlertDialog(onDismissRequest = onDismiss, title = { Text("连接 Forge Core") }, text = {
        Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("原生聊天直接连接 Core API，无需部署 Web 界面。", style = MaterialTheme.typography.bodyMedium)
            OutlinedTextField(url, { url = it }, label = { Text("服务器地址") },
                placeholder = { Text("http://192.168.1.10:5173") }, singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri), modifier = Modifier.testTag("connection-url"))
            OutlinedTextField(credential, { credential = it }, label = { Text(if (pair) "一次性配对码（可选）" else "设备凭据（可选）") },
                singleLine = true, visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth())
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(pair, { pair = it }); Text("使用一次性配对码换取设备凭据", style = MaterialTheme.typography.bodySmall)
            }
            Text("可信局域网直连通常留空。凭据只保留在本次进程；重启应用后需重新填写。HTTP 不加密，勿直接暴露到公网。", style = MaterialTheme.typography.bodySmall)
            if (state.workspace.isNotEmpty()) Text("远端工作区\n${state.workspace}", style = MaterialTheme.typography.bodySmall)
            if (state.connection != ConnectionPhase.Disconnected) TextButton(onClick = { actions.disconnect(); onDismiss() }, enabled = !state.sending && !state.busy) { Text("断开连接（不停止远端任务）") }
        }
    }, confirmButton = { TextButton(onClick = { actions.connect(url, credential, pair); credential = ""; onDismiss() },
        enabled = url.isNotBlank() && (!pair || credential.isNotBlank()) && !state.sending && !state.busy, modifier = Modifier.testTag("connect")) { Text("连接") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } })
}

@Composable private fun ModelDialog(state: ChatUiState, onSelect: (String) -> Unit, onDismiss: () -> Unit) {
    var search by remember { mutableStateOf("") }
    AlertDialog(onDismissRequest = onDismiss, title = { Text("选择模型") }, text = {
        Column {
            OutlinedTextField(search, { search = it }, singleLine = true, placeholder = { Text("搜索服务器模型") })
            LazyColumn(Modifier.heightIn(max = 340.dp)) {
                item { ListItem(headlineContent = { Text("服务器默认模型") }, modifier = Modifier.clickable { onSelect("") }) }
                items(state.models.filter { it.contains(search, true) }) { model ->
                    ListItem(headlineContent = { Text(model) }, modifier = Modifier.clickable { onSelect(model) })
                }
            }
            Text("仅使用 Core 提供的模型目录；访问配置留在服务器。", style = MaterialTheme.typography.bodySmall)
        }
    }, confirmButton = { TextButton(onClick = onDismiss) { Text("完成") } })
}

private fun phaseName(phase: ConnectionPhase) = when (phase) {
    ConnectionPhase.Disconnected -> "尚未连接"
    ConnectionPhase.Connecting -> "正在连接"
    ConnectionPhase.Connected -> "已连接"
    ConnectionPhase.Reconnecting -> "正在重连"
    ConnectionPhase.Paused -> "连接已暂停"
}
