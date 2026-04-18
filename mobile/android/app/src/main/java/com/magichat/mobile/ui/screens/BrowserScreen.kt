package com.magichat.mobile.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.OpenInBrowser
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.magichat.mobile.model.canRunCommands
import com.magichat.mobile.state.MagicHatUiState
import com.magichat.mobile.ui.components.HostContextCard
import com.magichat.mobile.ui.components.StatusChip

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BrowserScreen(
    state: MagicHatUiState,
    onBrowserUrlChanged: (String) -> Unit,
    onBrowserSearchChanged: (String) -> Unit,
    onBrowserSearchEngineChanged: (String) -> Unit,
    onOpenBrowserUrl: () -> Unit,
    onSearchInBrowser: () -> Unit,
    onSelectPage: (String) -> Unit,
    onRefresh: () -> Unit,
    onRefreshActiveHost: () -> Unit,
) {
    val hasActiveHost = state.activeHost != null
    val canRunCommands = state.activeHost?.canRunCommands(state.activeHostPresence) == true

    PullToRefreshBox(
        isRefreshing = state.isLoading && hasActiveHost,
        onRefresh = onRefresh,
        modifier = Modifier.fillMaxWidth(),
    ) {
        LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item {
                Text("Browser", style = MaterialTheme.typography.headlineSmall)
            }

            item {
                HostContextCard(
                    host = state.activeHost,
                    presence = state.activeHostPresence,
                    activeInstanceId = state.browserSelectedPageId,
                    onRefreshStatus = if (state.activeHost != null) onRefreshActiveHost else null,
                    refreshEnabled = state.isLoading.not(),
                )
            }

            item {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = onRefresh, enabled = hasActiveHost && state.isLoading.not()) {
                        Icon(Icons.Outlined.Refresh, contentDescription = null)
                        Text(" Refresh")
                    }
                    Text(
                        "Persistent browser control on the host. Works for LAN and remote relay hosts.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = 10.dp),
                    )
                }
            }

            item {
                BrowserActionsCard(
                    state = state,
                    canRunCommands = canRunCommands,
                    onBrowserUrlChanged = onBrowserUrlChanged,
                    onBrowserSearchChanged = onBrowserSearchChanged,
                    onBrowserSearchEngineChanged = onBrowserSearchEngineChanged,
                    onOpenBrowserUrl = onOpenBrowserUrl,
                    onSearchInBrowser = onSearchInBrowser,
                )
            }

            item {
                Text("Open Pages", style = MaterialTheme.typography.titleMedium)
            }

            if (!hasActiveHost) {
                item {
                    Text(
                        "Choose a host on the Hosts screen first.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            } else if (state.browserPages.isEmpty()) {
                item {
                    Text(
                        "No pages discovered yet. Open a URL or search to start a browser session.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            } else {
                items(state.browserPages, key = { it.pageId }) { page ->
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Column(
                            modifier = Modifier.padding(16.dp),
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                StatusChip(
                                    label = if (page.selected) "selected" else "background",
                                    background = MaterialTheme.colorScheme.secondaryContainer,
                                    contentColor = MaterialTheme.colorScheme.onSecondaryContainer,
                                )
                                Text(page.pageId, style = MaterialTheme.typography.bodySmall)
                            }
                            Text(
                                page.title?.takeIf { it.isNotBlank() } ?: page.url,
                                style = MaterialTheme.typography.titleMedium,
                            )
                            Text(
                                page.url,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            OutlinedButton(
                                onClick = { onSelectPage(page.pageId) },
                                enabled = canRunCommands && state.isLoading.not() && !page.selected,
                            ) {
                                Text(if (page.selected) "Selected" else "Select Page")
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun BrowserActionsCard(
    state: MagicHatUiState,
    canRunCommands: Boolean,
    onBrowserUrlChanged: (String) -> Unit,
    onBrowserSearchChanged: (String) -> Unit,
    onBrowserSearchEngineChanged: (String) -> Unit,
    onOpenBrowserUrl: () -> Unit,
    onSearchInBrowser: () -> Unit,
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(Icons.Outlined.OpenInBrowser, contentDescription = null)
                Text("Open URL", style = MaterialTheme.typography.titleMedium)
            }
            OutlinedTextField(
                value = state.browserUrlInput,
                onValueChange = onBrowserUrlChanged,
                modifier = Modifier.fillMaxWidth(),
                label = { Text("URL") },
                placeholder = { Text("youtube.com or https://example.com") },
                singleLine = true,
                enabled = canRunCommands && state.isLoading.not(),
            )
            Button(
                onClick = onOpenBrowserUrl,
                enabled = canRunCommands && state.isLoading.not() && state.browserUrlInput.isNotBlank(),
            ) {
                Text("Open URL")
            }

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(Icons.Outlined.Search, contentDescription = null)
                Text("Web Search", style = MaterialTheme.typography.titleMedium)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("google", "youtube", "bing", "ddg").forEach { engine ->
                    FilterChip(
                        selected = state.browserSearchEngine == engine,
                        onClick = { onBrowserSearchEngineChanged(engine) },
                        enabled = canRunCommands && state.isLoading.not(),
                        label = { Text(engine) },
                    )
                }
            }
            OutlinedTextField(
                value = state.browserSearchInput,
                onValueChange = onBrowserSearchChanged,
                modifier = Modifier.fillMaxWidth(),
                label = { Text("Search Query") },
                placeholder = { Text("lofi mix") },
                singleLine = true,
                enabled = canRunCommands && state.isLoading.not(),
            )
            Button(
                onClick = onSearchInBrowser,
                enabled = canRunCommands && state.isLoading.not() && state.browserSearchInput.isNotBlank(),
            ) {
                Text("Search")
            }
        }
    }
}
