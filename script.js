const SUPABASE_URL = "https://ekcahonespbbmrkixnyd.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_diO7A99UFzWVc6aOQ7Hg7Q_XGuXfOXv";

let supabaseClient = null;

try {
    if (window.supabase) {
        supabaseClient = window.supabase.createClient(
            SUPABASE_URL,
            SUPABASE_ANON_KEY
        );
    }
} catch (e) {
    console.error("Failed to initialize Supabase client:", e);
}

// ==========================================
// STATE MANAGEMENT
// ==========================================

let currentUser = null;
let peerUser = null;
let currentConversationId = null;

let messagesPaginationOffset = 0;
const PAGE_SIZE = 30;

let realtimeChannel = null;
let presenceChannel = null;

let typingTimeout = null;
let isTypingSent = false;

const EMOJI_LIST = [
    '😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','🙃','😉','😌',
    '😍','🥰','😘','😗','😙','😚','😋','😛','😝','😜','🤪','🤨','🧐','🤓',
    '😎','🤩','🥳','😏','😒','😞','😔','😕','🙁','☹️','😣','😖','😫','🥱',
    '🥺','😢','❤','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❤️‍🔥',
    '❤‍🩹','❣️','💕','💞','💓','👍','👎','✊','👊','🤛','🤜','🤞','✌️',
    '🤟','🤘','👌','🤌','🤏','👈','👉','👆','🔥','✨','⭐','🌟','💬',
    '🎉','🚀','💡','👑','💎','🍕','☕','🍺','🎵','🎶','⚽'
];

// ==========================================
// INITIALIZATION
// ==========================================

document.addEventListener("DOMContentLoaded", async () => {
    initTheme();
    initEmojiPicker();
    setupTextareaAutoResize();
    setupSettingsButton();
    setupGlobalClickHandlers();
    setupSearchInput();

    const savedUser = localStorage.getItem("duet_current_user");

    if (savedUser) {
        try {
            currentUser = JSON.parse(savedUser);

            if (!currentUser?.id || !currentUser?.username) {
                throw new Error("Invalid saved session");
            }

            await initializeAppSession();

        } catch (err) {
            console.error("Session restore error:", err);

            localStorage.removeItem("duet_current_user");
            currentUser = null;
        }
    }
});

// ==========================================
// AUTHENTICATION
// ==========================================

async function handleLogin(event) {
    event.preventDefault();

    const usernameInput = document
        .getElementById("username-input")
        ?.value
        .trim();

    const passwordInput =
        document.getElementById("password-input")?.value || "";

    const loginBtn = document.getElementById("login-btn");

    hideLoginError();

    if (!usernameInput || !passwordInput) {
        showError("Please enter both username and password.");
        return;
    }

    if (passwordInput !== "12112") {
        showError("Invalid password.");
        return;
    }

    const validNames = ["Krishna Bea", "Yearner"];

    const matchedName = validNames.find(
        name => name.toLowerCase() === usernameInput.toLowerCase()
    );

    if (!matchedName) {
        showError(
            "Unauthorized username. Only Krishna Bea and Yearner are permitted."
        );
        return;
    }

    setLoading(loginBtn, true);

    try {
        if (!supabaseClient) {
            throw new Error("Supabase client is not initialized.");
        }

        const { data: profile, error } = await supabaseClient
            .from("profiles")
            .select("*")
            .ilike("username", matchedName)
            .maybeSingle();

        if (error) {
            throw error;
        }

        if (!profile) {
            showError(
                "User profile not found. Create the two profiles in Supabase first."
            );
            return;
        }

        currentUser = {
            id: profile.id,
            username: profile.username,
            avatar:
                profile.avatar_url ||
                createAvatar(profile.username)
        };

        localStorage.setItem(
            "duet_current_user",
            JSON.stringify(currentUser)
        );

        await initializeAppSession();

    } catch (err) {
        console.error("Login error:", err);

        showError(
            "Unable to connect to Supabase. Check your database setup."
        );
    } finally {
        setLoading(loginBtn, false);
    }
}

function createAvatar(username) {
    return `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(
        username
    )}`;
}

function showError(message) {
    const errorDiv = document.getElementById("login-error");

    if (!errorDiv) return;

    errorDiv.textContent = message;
    errorDiv.classList.remove("hidden");
}

function hideLoginError() {
    const errorDiv = document.getElementById("login-error");

    if (errorDiv) {
        errorDiv.classList.add("hidden");
        errorDiv.textContent = "";
    }
}

function setLoading(button, loading) {
    if (!button) return;

    const btnText = button.querySelector(".btn-text");
    const spinner = button.querySelector(".spinner");

    button.disabled = loading;

    if (btnText) {
        btnText.classList.toggle("hidden", loading);
    }

    if (spinner) {
        spinner.classList.toggle("hidden", !loading);
    }
}

// ==========================================
// APP SESSION
// ==========================================

async function initializeAppSession() {
    if (!currentUser) return;

    const loginContainer =
        document.getElementById("login-container");

    const appContainer =
        document.getElementById("app-container");

    if (loginContainer) {
        loginContainer.classList.add("hidden");
    }

    if (appContainer) {
        appContainer.classList.remove("hidden");
    }

    updateCurrentUserUI();

    messagesPaginationOffset = 0;

    await loadPeerAndConversation();

    if (!currentConversationId) {
        showToast("Conversation could not be loaded.");
        return;
    }

    await loadMessages(false);

    setupRealtimeSubscriptions();
    setupPresence();
}

function updateCurrentUserUI() {
    const myNameEl = document.getElementById("my-name");
    const myAvatarEl = document.getElementById("my-avatar");
    const settingsDisplay =
        document.getElementById("settings-username-display");

    if (myNameEl) {
        myNameEl.textContent = currentUser.username;
    }

    if (myAvatarEl) {
        myAvatarEl.src = currentUser.avatar;
    }

    if (settingsDisplay) {
        settingsDisplay.textContent =
            `Logged in as ${currentUser.username}`;
    }
}

async function logout() {
    stopTyping();

    if (realtimeChannel && supabaseClient) {
        await supabaseClient.removeChannel(realtimeChannel);
        realtimeChannel = null;
    }

    if (presenceChannel && supabaseClient) {
        await supabaseClient.removeChannel(presenceChannel);
        presenceChannel = null;
    }

    currentUser = null;
    peerUser = null;
    currentConversationId = null;

    localStorage.removeItem("duet_current_user");

    window.location.reload();
}

// ==========================================
// PEER + CONVERSATION
// ==========================================

async function loadPeerAndConversation() {
    try {
        const { data: profiles, error } = await supabaseClient
            .from("profiles")
            .select("*")
            .neq("id", currentUser.id)
            .limit(1);

        if (error) {
            throw error;
        }

        if (!profiles || profiles.length === 0) {
            throw new Error("Peer profile not found.");
        }

        const profile = profiles[0];

        peerUser = {
            id: profile.id,
            username: profile.username,
            avatar:
                profile.avatar_url ||
                createAvatar(profile.username)
        };

        updatePeerUI();

        const { data: conversations, error: conversationError } =
            await supabaseClient
                .from("conversations")
                .select("id")
                .order("created_at", { ascending: true })
                .limit(1);

        if (conversationError) {
            throw conversationError;
        }

        if (conversations && conversations.length > 0) {
            currentConversationId = conversations[0].id;
            return;
        }

        const { data: newConversation, error: createError } =
            await supabaseClient
                .from("conversations")
                .insert({})
                .select("id")
                .single();

        if (createError) {
            throw createError;
        }

        currentConversationId = newConversation.id;

    } catch (error) {
        console.error("Conversation loading error:", error);

        currentConversationId = null;

        showToast(
            "Failed to load conversation. Check your Supabase database."
        );
    }
}

function updatePeerUI() {
    if (!peerUser) return;

    setText("peer-name-sidebar", peerUser.username);
    setText("peer-name-header", peerUser.username);
    setText("details-name", peerUser.username);

    setImage("peer-avatar-sidebar", peerUser.avatar);
    setImage("peer-avatar-header", peerUser.avatar);
    setImage("details-avatar", peerUser.avatar);

    updateOnlineStatusUI(false);
}

function setText(id, value) {
    const element = document.getElementById(id);

    if (element) {
        element.textContent = value;
    }
}

function setImage(id, src) {
    const element = document.getElementById(id);

    if (element) {
        element.src = src;
    }
}

// ==========================================
// MESSAGES
// ==========================================

async function loadMessages(loadMore = false) {
    if (!currentConversationId || !supabaseClient) return;

    try {
        if (!loadMore) {
            messagesPaginationOffset = 0;
        }

        const start = messagesPaginationOffset;
        const end = start + PAGE_SIZE - 1;

        const { data: msgs, error } = await supabaseClient
            .from("messages")
            .select("*")
            .eq("conversation_id", currentConversationId)
            .order("created_at", { ascending: false })
            .range(start, end);

        if (error) {
            throw error;
        }

        const messageList =
            document.getElementById("message-list");

        if (!messageList) return;

        if (!loadMore) {
            messageList.innerHTML = "";
        }

        const messages = msgs || [];

        messages.reverse();

        messages.forEach(message => {
            renderMessage(message, loadMore);
        });

        const trigger =
            document.getElementById("load-more-trigger");

        if (trigger) {
            trigger.classList.toggle(
                "hidden",
                messages.length < PAGE_SIZE
            );
        }

        if (!loadMore) {
            const newestMessage = messages[messages.length - 1];

            if (newestMessage) {
                updateSidebarPreview(newestMessage);
            }

            scrollToBottom();
            markMessagesAsRead();
        }

    } catch (error) {
        console.error("Error loading messages:", error);
        showToast("Failed to load messages.");
    }
}

async function loadMoreMessages() {
    if (!currentConversationId) return;

    messagesPaginationOffset += PAGE_SIZE;

    await loadMessages(true);
}

function renderMessage(message, prepend = false) {
    const messageList =
        document.getElementById("message-list");

    if (!messageList || !currentUser) return;

    if (
        document.querySelector(
            `.message-row[data-id="${CSS.escape(String(message.id))}"]`
        )
    ) {
        return;
    }

    const isSent =
        message.sender_id === currentUser.id;

    const row = document.createElement("div");

    row.className =
        `message-row ${isSent ? "sent" : "received"}`;

    row.dataset.id = message.id;

    const bubble =
        document.createElement("div");

    bubble.className = "message-bubble";

    if (message.message_type === "image") {
        const image = document.createElement("img");

        image.src = message.content;
        image.className = "message-image";
        image.alt = "Sent image";
        image.loading = "lazy";

        image.addEventListener("click", () => {
            openLightbox(message.content);
        });

        bubble.appendChild(image);

    } else {
        bubble.textContent = message.content;
    }

    const meta =
        document.createElement("div");

    meta.className = "message-meta";

    const time =
        new Date(message.created_at)
            .toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit"
            });

    const timeSpan =
        document.createElement("span");

    timeSpan.textContent = time;

    meta.appendChild(timeSpan);

    if (isSent) {
        const status =
            document.createElement("span");

        status.className = "read-status";
        status.textContent =
            message.read ? " ✓✓" : " ✓";

        meta.appendChild(status);
    }

    bubble.appendChild(meta);
    row.appendChild(bubble);

    if (prepend) {
        messageList.insertBefore(
            row,
            messageList.firstChild
        );
    } else {
        messageList.appendChild(row);
    }

    if (!prepend) {
        updateSidebarPreview(message);
    }
}

// ==========================================
// SEND MESSAGE
// ==========================================

async function sendMessage() {
    const textarea =
        document.getElementById("message-textarea");

    if (!textarea || !currentUser || !currentConversationId) {
        return;
    }

    const text = textarea.value.trim();

    if (!text) return;

    textarea.value = "";
    autoResizeTextarea(textarea);

    stopTyping();

    try {
        const { data, error } =
            await supabaseClient
                .from("messages")
                .insert([{
                    conversation_id: currentConversationId,
                    sender_id: currentUser.id,
                    content: text,
                    message_type: "text",
                    read: false
                }])
                .select()
                .single();

        if (error) {
            throw error;
        }

        renderMessage(data);
        scrollToBottom();

    } catch (error) {
        console.error("Failed to send message:", error);

        textarea.value = text;
        autoResizeTextarea(textarea);

        showToast("Failed to send message.");
    }
}

function sendQuickReply(text) {
    const textarea =
        document.getElementById("message-textarea");

    if (!textarea) return;

    textarea.value = text;
    autoResizeTextarea(textarea);
    sendMessage();
}

// ==========================================
// IMAGE UPLOAD
// ==========================================

async function handleImageUpload(event) {
    const file = event.target.files?.[0];

    if (!file) return;

    event.target.value = "";

    if (!currentConversationId || !currentUser) {
        showToast("Chat is not ready.");
        return;
    }

    if (file.size > 5 * 1024 * 1024) {
        showToast("Image must be under 5MB.");
        return;
    }

    const allowedTypes = [
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/gif"
    ];

    if (!allowedTypes.includes(file.type)) {
        showToast(
            "Use JPG, PNG, WEBP or GIF."
        );
        return;
    }

    showToast("Uploading image...");

    try {
        const extension =
            file.name.split(".").pop()?.toLowerCase() || "jpg";

        const fileName =
            `${Date.now()}_${crypto.randomUUID()}.${extension}`;

        const filePath =
            `chat_uploads/${fileName}`;

        const { error: uploadError } =
            await supabaseClient.storage
                .from("chat-media")
                .upload(filePath, file, {
                    cacheControl: "3600",
                    upsert: false,
                    contentType: file.type
                });

        if (uploadError) {
            throw uploadError;
        }

        const {
            data: publicData
        } = supabaseClient.storage
            .from("chat-media")
            .getPublicUrl(filePath);

        const publicUrl =
            publicData?.publicUrl;

        if (!publicUrl) {
            throw new Error("Could not create public image URL.");
        }

        const { data, error } =
            await supabaseClient
                .from("messages")
                .insert([{
                    conversation_id: currentConversationId,
                    sender_id: currentUser.id,
                    content: publicUrl,
                    message_type: "image",
                    read: false
                }])
                .select()
                .single();

        if (error) {
            throw error;
        }

        renderMessage(data);
        scrollToBottom();
        appendSharedMediaThumb(publicUrl);

        showToast("Image sent.");

    } catch (error) {
        console.error("Image upload failed:", error);

        showToast(
            "Image upload failed. Check the chat-media bucket and policies."
        );
    }
}

// ==========================================
// REALTIME
// ==========================================

function setupRealtimeSubscriptions() {
    if (!currentConversationId || !supabaseClient) {
        return;
    }

    if (realtimeChannel) {
        supabaseClient.removeChannel(realtimeChannel);
    }

    realtimeChannel =
        supabaseClient.channel(
            `room:${currentConversationId}`
        );

    realtimeChannel
        .on(
            "postgres_changes",
            {
                event: "INSERT",
                schema: "public",
                table: "messages",
                filter:
                    `conversation_id=eq.${currentConversationId}`
            },
            payload => {
                const message = payload.new;

                if (
                    !message ||
                    message.sender_id === currentUser.id
                ) {
                    return;
                }

                renderMessage(message);
                updateSidebarPreview(message);
                scrollToBottom();

                markMessagesAsRead();
                playNotificationSound();
            }
        )
        .on(
            "postgres_changes",
            {
                event: "UPDATE",
                schema: "public",
                table: "messages",
                filter:
                    `conversation_id=eq.${currentConversationId}`
            },
            payload => {
                updateReadReceipt(payload.new);
            }
        )
        .on(
            "broadcast",
            {
                event: "typing"
            },
            payload => {
                if (
                    payload?.payload?.userId &&
                    payload.payload.userId !== currentUser.id
                ) {
                    showTypingIndicator(
                        payload.payload.isTyping
                    );
                }
            }
        )
        .subscribe(status => {
            console.log(
                "Realtime status:",
                status
            );
        });
}

function updateReadReceipt(message) {
    if (!message?.read) return;

    const row =
        document.querySelector(
            `.message-row[data-id="${CSS.escape(String(message.id))}"]`
        );

    if (!row) return;

    const status =
        row.querySelector(".read-status");

    if (status) {
        status.textContent = " ✓✓";
    }
}

// ==========================================
// PRESENCE
// ==========================================

function setupPresence() {
    if (!supabaseClient || !currentUser) {
        return;
    }

    if (presenceChannel) {
        supabaseClient.removeChannel(presenceChannel);
    }

    presenceChannel =
        supabaseClient.channel("online-users");

    presenceChannel
        .on(
            "presence",
            {
                event: "sync"
            },
            () => {
                const state =
                    presenceChannel.presenceState();

                let peerOnline = false;

                Object.values(state).forEach(users => {
                    users.forEach(user => {
                        if (
                            peerUser &&
                            user.userId === peerUser.id
                        ) {
                            peerOnline = true;
                        }
                    });
                });

                updateOnlineStatusUI(peerOnline);
            }
        )
        .subscribe(async status => {
            if (
                status === "SUBSCRIBED" &&
                currentUser
            ) {
                try {
                    await presenceChannel.track({
                        userId: currentUser.id,
                        online_at:
                            new Date().toISOString()
                    });
                } catch (error) {
                    console.error(
                        "Presence tracking error:",
                        error
                    );
                }
            }
        });
}

function updateOnlineStatusUI(isOnline) {
    const sidebarDot =
        document.getElementById("peer-status-dot");

    const headerDot =
        document.getElementById("peer-status-dot-header");

    const statusText =
        document.getElementById("peer-status-text");

    const detailsStatus =
        document.getElementById("details-status");

    if (sidebarDot) {
        sidebarDot.className =
            `status-indicator ${
                isOnline ? "online" : "offline"
            }`;
    }

    if (headerDot) {
        headerDot.className =
            `status-indicator ${
                isOnline ? "online" : "offline"
            }`;
    }

    if (statusText) {
        statusText.textContent =
            isOnline ? "Active now" : "Offline";
    }

    if (detailsStatus) {
        detailsStatus.textContent =
            isOnline ? "Online" : "Offline";
    }
}

// ==========================================
// TYPING
// ==========================================

function handleTypingEvent() {
    const textarea =
        document.getElementById("message-textarea");

    if (textarea) {
        autoResizeTextarea(textarea);
    }

    if (!isTypingSent) {
        isTypingSent = true;
        sendTypingBroadcast(true);
    }

    clearTimeout(typingTimeout);

    typingTimeout = setTimeout(() => {
        isTypingSent = false;
        sendTypingBroadcast(false);
    }, 2000);
}

function stopTyping() {
    clearTimeout(typingTimeout);

    if (isTypingSent) {
        isTypingSent = false;
        sendTypingBroadcast(false);
    }
}

function sendTypingBroadcast(isTyping) {
    if (!realtimeChannel || !currentUser) {
        return;
    }

    realtimeChannel.send({
        type: "broadcast",
        event: "typing",
        payload: {
            userId: currentUser.id,
            isTyping
        }
    });
}

function showTypingIndicator(isTyping) {
    const indicator =
        document.getElementById("typing-indicator");

    const typingText =
        document.getElementById("typing-text");

    if (!indicator || !typingText) return;

    if (isTyping) {
        typingText.textContent =
            `${peerUser?.username || "User"} is typing...`;

        indicator.classList.remove("hidden");

        scrollToBottom();

    } else {
        indicator.classList.add("hidden");
    }
}

// ==========================================
// READ RECEIPTS
// ==========================================

async function markMessagesAsRead() {
    if (
        !currentConversationId ||
        !currentUser ||
        !supabaseClient
    ) {
        return;
    }

    try {
        const { error } =
            await supabaseClient
                .from("messages")
                .update({
                    read: true
                })
                .eq(
                    "conversation_id",
                    currentConversationId
                )
                .neq(
                    "sender_id",
                    currentUser.id
                )
                .eq(
                    "read",
                    false
                );

        if (error) {
            console.error(
                "Read receipt error:",
                error
            );
        }

    } catch (error) {
        console.error(
            "Mark read error:",
            error
        );
    }
}

// ==========================================
// SIDEBAR PREVIEW
// ==========================================

function updateSidebarPreview(message) {
    const preview =
        document.getElementById("conv-last-msg");

    const time =
        document.getElementById("conv-time");

    if (preview) {
        preview.textContent =
            message.message_type === "image"
                ? "📷 Sent an image"
                : message.content;
    }

    if (time) {
        time.textContent =
            new Date(
                message.created_at
            ).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit"
            });
    }
}

// ==========================================
// TEXTAREA
// ==========================================

function handleKeyInput(event) {
    if (
        event.key === "Enter" &&
        !event.shiftKey
    ) {
        event.preventDefault();
        sendMessage();
    }
}

function autoResizeTextarea(element) {
    if (!element) return;

    element.style.height = "auto";

    element.style.height =
        Math.min(
            element.scrollHeight,
            120
        ) + "px";
}

function setupTextareaAutoResize() {
    const textarea =
        document.getElementById("message-textarea");

    if (!textarea) return;

    textarea.addEventListener(
        "input",
        () => autoResizeTextarea(textarea)
    );
}

// ==========================================
// EMOJI PICKER
// ==========================================

function initEmojiPicker() {
    const grid =
        document.getElementById("emoji-grid");

    if (!grid) return;

    grid.innerHTML = "";

    EMOJI_LIST.forEach(emoji => {
        const item =
            document.createElement("span");

        item.className = "emoji-item";
        item.textContent = emoji;
        item.setAttribute("role", "button");
        item.tabIndex = 0;

        item.addEventListener("click", () => {
            insertEmoji(emoji);
        });

        item.addEventListener(
            "keydown",
            event => {
                if (
                    event.key === "Enter" ||
                    event.key === " "
                ) {
                    event.preventDefault();
                    insertEmoji(emoji);
                }
            }
        );

        grid.appendChild(item);
    });
}

function insertEmoji(emoji) {
    const textarea =
        document.getElementById("message-textarea");

    if (!textarea) return;

    textarea.value += emoji;
    textarea.focus();

    autoResizeTextarea(textarea);
}

function toggleEmojiPicker(event) {
    if (event) {
        event.stopPropagation();
    }

    const popup =
        document.getElementById("emoji-picker-popup");

    if (popup) {
        popup.classList.toggle("hidden");
    }
}

// ==========================================
// SEARCH
// ==========================================

function setupSearchInput() {
    const input =
        document.getElementById("chat-search-input");

    if (!input) return;

    input.addEventListener(
        "input",
        event => {
            handleMessageSearch(
                event.target.value
            );
        }
    );
}

function handleMessageSearch(query) {
    const rows =
        document.querySelectorAll(
            ".message-row"
        );

    const search =
        query.trim().toLowerCase();

    rows.forEach(row => {
        const text =
            row.textContent.toLowerCase();

        row.style.display =
            !search || text.includes(search)
                ? ""
                : "none";
    });
}

function toggleSearchPanel() {
    const bar =
        document.getElementById(
            "chat-search-bar"
        );

    if (!bar) return;

    bar.classList.toggle("hidden");

    if (!bar.classList.contains("hidden")) {
        const input =
            document.getElementById(
                "chat-search-input"
            );

        if (input) {
            input.focus();
        }

    } else {
        const input =
            document.getElementById(
                "chat-search-input"
            );

        if (input) {
            input.value = "";
        }

        handleMessageSearch("");
    }
}

// ==========================================
// DETAILS PANEL
// ==========================================

function toggleDetailsPanel() {
    const panel =
        document.getElementById(
            "details-panel"
        );

    if (!panel) return;

    panel.classList.toggle("hidden");

    if (!panel.classList.contains("hidden")) {
        loadSharedMediaThumbnails();
    }
}

async function loadSharedMediaThumbnails() {
    const grid =
        document.getElementById(
            "shared-media-grid"
        );

    if (
        !grid ||
        !supabaseClient ||
        !currentConversationId
    ) {
        return;
    }

    grid.innerHTML = "";

    try {
        const { data, error } =
            await supabaseClient
                .from("messages")
                .select("content")
                .eq(
                    "conversation_id",
                    currentConversationId
                )
                .eq(
                    "message_type",
                    "image"
                )
                .order(
                    "created_at",
                    {
                        ascending: false
                    }
                );

        if (error) {
            throw error;
        }

        (data || []).forEach(item => {
            appendSharedMediaThumb(
                item.content,
                false
            );
        });

    } catch (error) {
        console.error(
            "Shared media error:",
            error
        );
    }
}

function appendSharedMediaThumb(
    url,
    prepend = true
) {
    const grid =
        document.getElementById(
            "shared-media-grid"
        );

    if (!grid) return;

    const image =
        document.createElement("img");

    image.src = url;
    image.className =
        "shared-media-thumb";

    image.loading = "lazy";
    image.alt = "Shared image";

    image.addEventListener(
        "click",
        () => openLightbox(url)
    );

    if (prepend) {
        grid.prepend(image);
    } else {
        grid.appendChild(image);
    }
}

// ==========================================
// LIGHTBOX
// ==========================================

function openLightbox(url) {
    const image =
        document.getElementById(
            "lightbox-img"
        );

    const lightbox =
        document.getElementById(
            "image-lightbox"
        );

    if (image) {
        image.src = url;
    }

    if (lightbox) {
        lightbox.classList.remove(
            "hidden"
        );
    }
}

function closeLightbox() {
    const lightbox =
        document.getElementById(
            "image-lightbox"
        );

    if (lightbox) {
        lightbox.classList.add(
            "hidden"
        );
    }
}

// ==========================================
// SETTINGS
// ==========================================

function setupSettingsButton() {
    const button =
        document.getElementById(
            "settings-toggle-btn"
        );

    if (!button) return;

    button.addEventListener(
        "click",
        () => {
            const modal =
                document.getElementById(
                    "settings-modal"
                );

            if (modal) {
                modal.classList.remove(
                    "hidden"
                );
            }
        }
    );
}

function toggleSettingsModal() {
    const modal =
        document.getElementById(
            "settings-modal"
        );

    if (modal) {
        modal.classList.add(
            "hidden"
        );
    }
}

function saveNickname() {
    const input =
        document.getElementById(
            "nickname-input"
        );

    if (!input || !peerUser) return;

    const nickname =
        input.value.trim();

    if (!nickname) {
        showToast("Enter a nickname.");
        return;
    }

    setText(
        "peer-name-header",
        nickname
    );

    setText(
        "peer-name-sidebar",
        nickname
    );

    showToast(
        "Nickname updated locally."
    );
}

function setAccentColor(colorHex) {
    if (!colorHex) return;

    document.documentElement.style.setProperty(
        "--primary-color",
        colorHex
    );

    document.documentElement.style.setProperty(
        "--primary-hover",
        colorHex
    );

    localStorage.setItem(
        "duet_accent",
        colorHex
    );

    showToast(
        "Theme accent updated."
    );
}

function changeTheme(mode) {
    document.documentElement.setAttribute(
        "data-theme",
        mode
    );

    localStorage.setItem(
        "duet_theme",
        mode
    );
}

function initTheme() {
    const savedTheme =
        localStorage.getItem(
            "duet_theme"
        ) || "light";

    document.documentElement.setAttribute(
        "data-theme",
        savedTheme
    );

    const select =
        document.getElementById(
            "theme-select"
        );

    if (select) {
        select.value = savedTheme;
    }

    const savedAccent =
        localStorage.getItem(
            "duet_accent"
        );

    if (savedAccent) {
        document.documentElement.style.setProperty(
            "--primary-color",
            savedAccent
        );

        document.documentElement.style.setProperty(
            "--primary-hover",
            savedAccent
        );
    }
}

// ==========================================
// AUDIO
// ==========================================

function playNotificationSound() {
    const toggle =
        document.getElementById(
            "sound-toggle"
        );

    if (
        toggle &&
        !toggle.checked
    ) {
        return;
    }

    try {
        const AudioContext =
            window.AudioContext ||
            window.webkitAudioContext;

        if (!AudioContext) return;

        const context =
            new AudioContext();

        const oscillator =
            context.createOscillator();

        const gain =
            context.createGain();

        oscillator.connect(gain);
        gain.connect(context.destination);

        oscillator.frequency.setValueAtTime(
            587.33,
            context.currentTime
        );

        gain.gain.setValueAtTime(
            0.08,
            context.currentTime
        );

        oscillator.start();

        oscillator.stop(
            context.currentTime + 0.15
        );

        oscillator.addEventListener(
            "ended",
            () => {
                context.close();
            }
        );

    } catch (error) {
        console.warn(
            "Notification sound unavailable."
        );
    }
}

// ==========================================
// TOAST
// ==========================================

function showToast(message) {
    const toast =
        document.getElementById(
            "toast"
        );

    if (!toast) return;

    toast.textContent = message;
    toast.classList.remove("hidden");

    clearTimeout(
        showToast.timeout
    );

    showToast.timeout =
        setTimeout(() => {
            toast.classList.add(
                "hidden"
            );
        }, 3000);
}

// ==========================================
// MOBILE
// ==========================================

function openChat() {
    if (window.innerWidth > 768) {
        return;
    }

    const sidebar =
        document.getElementById(
            "sidebar"
        );

    const chatArea =
        document.getElementById(
            "chat-area"
        );

    if (sidebar) {
        sidebar.classList.add(
            "mobile-hidden"
        );
    }

    if (chatArea) {
        chatArea.classList.remove(
            "mobile-hidden"
        );
    }
}

function closeChatMobile() {
    if (window.innerWidth > 768) {
        return;
    }

    const sidebar =
        document.getElementById(
            "sidebar"
        );

    const chatArea =
        document.getElementById(
            "chat-area"
        );

    if (sidebar) {
        sidebar.classList.remove(
            "mobile-hidden"
        );
    }

    if (chatArea) {
        chatArea.classList.add(
            "mobile-hidden"
        );
    }
}

// ==========================================
// GLOBAL EVENTS
// ==========================================

function setupGlobalClickHandlers() {
    document.addEventListener(
        "click",
        event => {
            const popup =
                document.getElementById(
                    "emoji-picker-popup"
                );

            const button =
                document.getElementById(
                    "emoji-picker-btn"
                );

            if (
                popup &&
                !popup.contains(event.target) &&
                button &&
                !button.contains(event.target)
            ) {
                popup.classList.add(
                    "hidden"
                );
            }
        }
    );

    document.addEventListener(
        "keydown",
        event => {
            if (event.key === "Escape") {
                closeLightbox();

                const emoji =
                    document.getElementById(
                        "emoji-picker-popup"
                    );

                if (emoji) {
                    emoji.classList.add(
                        "hidden"
                    );
                }
            }
        }
    );
}