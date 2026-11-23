// 1. إعدادات Supabase
const SUPABASE_URL = 'https://ahgokztpqzzknphuyyys.supabase.co';
const SUPABASE_KEY = 'sb_publishable_Z3OH28tFzHhPyyP6xaUICA_yZk9gopk'
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let currentUser = null;
let currentPassword = '';
let currentLang = 'ar';

function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 2. Service Worker
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(err => console.log('SW Error:', err));
}

let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const installBtn = document.getElementById('installBtn');
    installBtn.classList.remove('hidden');
    installBtn.addEventListener('click', () => {
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then(() => {
            installBtn.classList.add('hidden');
            deferredPrompt = null;
        });
    });
});

// 3. تسجيل الدخول
document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;
    const errorEl = document.getElementById('loginError');
    errorEl.textContent = currentLang === 'ar' ? "جاري التحقق..." : "Verifying...";

    const { data, error } = await db.rpc('login_user', { p_username: username, p_password: password });
    const user = data && data.length ? data[0] : null;

    if (error || !user) {
        errorEl.textContent = currentLang === 'ar' ? "خطأ في اسم المستخدم أو كلمة المرور!" : "Invalid credentials!";
        return;
    }

    currentUser = user;
    currentPassword = password;
    errorEl.textContent = "";
    document.getElementById('loginSection').classList.add('hidden');

    if (user.role === 'super_admin' || user.role === 'admin' || (user.permissions && user.permissions.length > 0)) {
        openAdminDashboard();
    } else {
        openStudentDashboard();
    }
});

// 4. واجهة الطالب وتسجيل الحضور
function openStudentDashboard() {
    document.getElementById('studentSection').classList.remove('hidden');
    document.getElementById('studentWelcome').textContent = `مرحباً: ${currentUser.full_name}`;
}

async function markAttendance() {
    const enteredName = document.getElementById('confirmFullName').value.trim();
    const statusEl = document.getElementById('attendanceStatus');

    if (!enteredName) {
        statusEl.style.color = "red";
        statusEl.textContent = "اكتب اسمك الثلاثي أولاً.";
        return;
    }

    statusEl.style.color = "#C59B27";
    statusEl.textContent = "جاري طلب الوصول للموقع الجغرافي (Location)...";

    if (!navigator.geolocation) {
        statusEl.style.color = "red";
        statusEl.textContent = "المتصفح لا يدعم تحديد الموقع.";
        return;
    }

    navigator.geolocation.getCurrentPosition(async (pos) => {
        const coords = `${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`;
        statusEl.textContent = "جاري تسجيل الحضور...";

        const { data, error } = await db.rpc('mark_attendance', {
            p_username: currentUser.username,
            p_password: currentPassword,
            p_entered_name: enteredName,
            p_location: coords
        });

        const status = !error && data ? data.status : 'error';

        if (status === 'ok') {
            statusEl.style.color = "green";
            statusEl.textContent = `✅ تم تسجيل حضورك بنجاح في مادة تفكير ابتكاري يوم ${data.day} الساعة ${data.time}`;
        } else if (status === 'duplicate') {
            statusEl.style.color = "red";
            statusEl.textContent = "لقد سجلت حضورك مسبقاً اليوم.";
        } else if (status === 'name_mismatch') {
            statusEl.style.color = "red";
            statusEl.textContent = "هذا الاسم غير مطابق للاسم المسجل في النظام.";
        } else if (status === 'bad_credentials') {
            statusEl.style.color = "red";
            statusEl.textContent = "انتهت الجلسة، سجّل الدخول مرة أخرى.";
        } else {
            console.error(error || data);
            statusEl.style.color = "red";
            statusEl.textContent = "تعذر التسجيل الآن، حاول مرة أخرى بعد قليل.";
        }
    }, () => {
        statusEl.style.color = "red";
        statusEl.textContent = "❌ يجب السماح بالوصول للموقع (Location) لتسجيل الحضور!";
    });
}

// 5. لوحة تحكم الإدارة
function hasPerm(perm) {
    return currentUser.role === 'super_admin' || (currentUser.permissions && currentUser.permissions.includes(perm));
}

async function openAdminDashboard() {
    document.getElementById('adminSection').classList.remove('hidden');
    document.getElementById('adminWelcome').textContent = `أهلاً: ${currentUser.full_name}`;

    const isSuper = currentUser.role === 'super_admin';
    document.getElementById('roleBadge').textContent = isSuper ? "مدير النظام (صلاحيات كاملة)" : "مشرف بصلاحيات محددة";

    if (!isSuper) {
        document.getElementById('alertsContainer').classList.add('hidden');
        document.getElementById('permissionsSection').classList.add('hidden');
    } else {
        loadAlerts();
    }

    if (!hasPerm('export_excel')) document.getElementById('exportExcelBtn').classList.add('hidden');
    if (!hasPerm('add_user')) document.getElementById('addUserForm').classList.add('hidden');

    loadAttendance();
    loadUsers();
}

async function loadAlerts() {
    const { data, error } = await db.rpc('admin_get_alerts', { p_admin: currentUser.username, p_pass: currentPassword });
    if (error) console.error(error);
    const list = document.getElementById('alertsList');
    list.innerHTML = "";
    if (data) {
        data.forEach(a => {
            const li = document.createElement('li');
            li.className = "alert-item";
            li.textContent = a.message + " ";
            const small = document.createElement('small');
            small.textContent = new Date(a.created_at).toLocaleString('ar-EG');
            li.appendChild(small);
            list.appendChild(li);
        });
    }
}

async function loadAttendance() {
    const { data, error } = await db.rpc('admin_get_attendance', { p_admin: currentUser.username, p_pass: currentPassword });
    if (error) console.error(error);
    const tbody = document.getElementById('attendanceBody');
    tbody.innerHTML = "";
    if (data) {
        data.forEach(row => {
            const loc = row.location
                ? `<a href="https://maps.google.com/?q=${encodeURIComponent(row.location)}" target="_blank">عرض الموقع</a>`
                : '-';
            tbody.innerHTML += `
                <tr>
                    <td>${esc(row.student_name)}</td>
                    <td>${esc(row.day_name)}</td>
                    <td>${esc(row.attend_date)}</td>
                    <td>${esc(row.attend_time)}</td>
                    <td>${loc}</td>
                </tr>`;
        });
    }
}

async function loadUsers() {
    const { data, error } = await db.rpc('admin_list_users', { p_admin: currentUser.username, p_pass: currentPassword });
    if (error) console.error(error);
    const tbody = document.getElementById('usersBody');
    tbody.innerHTML = "";
    if (data) {
        data.forEach(u => {
            let actionsHtml = "";
            if (hasPerm('warn_user')) {
                actionsHtml += `<button onclick="warnUser('${esc(u.id)}', ${Number(u.warnings_count) || 0})" class="btn-outline" style="margin:0 4px;">تحذير</button>`;
            }
            if (hasPerm('delete_user')) {
                actionsHtml += `<button onclick="deleteUser('${esc(u.id)}')" class="btn-danger-sm">حذف</button>`;
            }
            tbody.innerHTML += `
                <tr>
                    <td>${esc(u.full_name)}</td>
                    <td>${esc(u.username)}</td>
                    <td>${esc(u.warnings_count)}</td>
                    <td>${actionsHtml || '-'}</td>
                </tr>`;
        });
    }
}

// إضافة مستخدم جديد
document.getElementById('addUserForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!hasPerm('add_user')) return;

    const fullName = document.getElementById('newFullName').value.trim();
    const username = document.getElementById('newUsername').value.trim();
    const password = document.getElementById('newPassword').value;

    let selectedPerms = [];
    if (currentUser.role === 'super_admin') {
        const checkboxes = document.querySelectorAll('.permissions-check input:checked');
        selectedPerms = Array.from(checkboxes).map(cb => cb.value);
    }

    const { data: ok, error } = await db.rpc('admin_add_user', {
        p_admin: currentUser.username,
        p_pass: currentPassword,
        p_username: username,
        p_full_name: fullName,
        p_password: password,
        p_permissions: selectedPerms
    });

    if (!error && ok) {
        alert("تمت إضافة المستخدم بنجاح!");
        document.getElementById('addUserForm').reset();
        loadUsers();
    } else {
        alert("خطأ: اسم المستخدم مستخدم بالفعل.");
    }
});

async function warnUser(id, count) {
    if (!hasPerm('warn_user')) return;
    await db.rpc('admin_warn_user', { p_admin: currentUser.username, p_pass: currentPassword, p_user_id: id });
    alert("تم تسجيل تحذير.");
    loadUsers();
}

async function deleteUser(id) {
    if (!hasPerm('delete_user')) return;
    if (!confirm("هل أنت متأكد من حذف هذا المستخدم؟")) return;
    const { data, error } = await db.rpc('admin_delete_user', {
        p_admin: currentUser.username,
        p_pass: currentPassword,
        p_user_id: id
    });
    if (error || !data) {
        alert("تعذر حذف المستخدم.");
    }
    loadUsers();
}

// 6. أدوات مساعدة
function sortTable(tableId, colIndex) {
    const table = document.getElementById(tableId);
    const tbody = table.tBodies[0];
    const rows = Array.from(tbody.rows);
    rows.sort((a, b) => a.cells[colIndex].textContent.localeCompare(b.cells[colIndex].textContent, 'ar'));
    rows.forEach(row => tbody.appendChild(row));
}

function sortUsersAZ() {
    sortTable('usersTable', 0);
}

function exportToExcel() {
    if (!hasPerm('export_excel')) return;
    const table = document.getElementById('attendanceTable');
    const wb = XLSX.utils.table_to_book(table, { sheet: "الحضور" });
    XLSX.writeFile(wb, `حضور ريضيات الاعمال  ${new Date().toISOString().split('T')[0]}.xlsx`);
}

function showTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
    document.getElementById(tabId).classList.remove('hidden');
}

function toggleLanguage() {
    currentLang = currentLang === 'ar' ? 'en' : 'ar';
    document.documentElement.dir = currentLang === 'ar' ? 'rtl' : 'ltr';
    document.getElementById('langToggle').textContent = currentLang === 'ar' ? 'English' : 'عربي';
    document.querySelectorAll('[data-ar]').forEach(el => {
        el.textContent = el.getAttribute(`data-${currentLang}`);
    });
}

function logout() {
    location.reload();
}