// CRM Logic - Updated 2026-06-01 to force cache clear
console.log('Classroom CRM loaded: 2026-06-01 13:18');

/**
 * Classroom CRM Logic - Firebase Enabled Version
 * Uses Firestore for data storage and Authentication for access control.
 */

// --- Firebase Imports (CDN) ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-analytics.js";
import {
    getFirestore, collection, getDocs, addDoc, updateDoc, deleteDoc, doc, setDoc, onSnapshot, query, orderBy, enableIndexedDbPersistence
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import {
    getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import Papa from "https://cdn.jsdelivr.net/npm/papaparse@5.4.1/+esm";

// --- Configuration ---
const firebaseConfig = {
    apiKey: "AIzaSyCRpgFvQV2k3bJDPCei0_xG3cCYKjP5Wuc",
    authDomain: "ceapp-2443b.firebaseapp.com",
    projectId: "ceapp-2443b",
    storageBucket: "ceapp-2443b.firebasestorage.app",
    messagingSenderId: "232900029041",
    appId: "1:232900029041:web:ad659130129a7b551e49d0",
    measurementId: "G-KCF18NDEPB"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const db = getFirestore(app);

// Enable Offline Persistence
enableIndexedDbPersistence(db).catch((err) => {
    if (err.code == 'failed-precondition') {
        console.warn("Multiple tabs open, persistence can only be enabled in one tab at a time.");
    } else if (err.code == 'unimplemented') {
        console.warn("The current browser does not support persistence.");
    }
});

const auth = getAuth(app);
const provider = new GoogleAuthProvider();

// --- Application State ---
const state = {
    user: null,
    students: [],
    schools: [],
    view: 'dashboard',
    currentId: null,
    filterStatus: null,
    filterClass: null,
    listeners: [], // to unsubscribe on logout
    pendingEmailTemplate: null,
    pendingEmailTemplate: null,
    pendingStatus: null, // to pass status query between views
    customTemplates: [], // Store user-defined email templates
    searchQuery: '', // Global search query
    currentFilteredList: [] // For bulk actions on filtered results
};

// --- DOM Elements ---
const contentArea = document.getElementById('content-area');
const pageTitle = document.getElementById('page-title');
const navItems = document.querySelectorAll('.nav-item');
const globalSearch = document.getElementById('global-search');
const loginOverlay = document.getElementById('login-overlay');
const appContainer = document.getElementById('app-container');
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const loginError = document.getElementById('login-error');
const userAvatar = document.getElementById('user-avatar');
const userName = document.getElementById('user-name');

// --- Class Definitions ---
const CLASS_DEFINITIONS = [
    { name: 'Sクラス (6-7歳)', startYear: 2019, endYear: 2020 },
    { name: 'Cクラス (5-6歳)', startYear: 2020, endYear: 2021 },
    { name: 'Qクラス (4-5歳)', startYear: 2021, endYear: 2022 },
    { name: 'Tクラス (3-4歳)', startYear: 2022, endYear: 2023 },
    { name: 'Dクラス (2-3歳)', startYear: 2023, endYear: 2024 },
    { name: 'PDクラス (1-2歳)', startYear: 2024, endYear: 2025 }
];

const STATUS_DEFINITIONS = [
    { value: 'inquiry_received', label: '問い合わせあり', color: '#2563eb', bg: '#dbeafe' },
    { value: 'considering_incoming', label: '検討中（入電待）', color: '#0891b2', bg: '#cffafe' },
    { value: 'considering_outgoing', label: '検討中（架電待）', color: '#d97706', bg: '#fef3c7' },
    { value: 'considering_longterm', label: '長期検討', color: '#475569', bg: '#f1f5f9' },
    { value: 'trial_booked', label: '体験予約中', color: '#ca8a04', bg: '#fef9c3' },
    { value: 'joined', label: '入会済み', color: '#16a34a', bg: '#dcfce7' },
    { value: 'suspended', label: '休会中', color: '#16a34a', bg: '#dcfce7' },
    { value: 'declined', label: '不承認', color: '#dc2626', bg: '#fee2e2' },
    { value: 'unresponsive', label: '音信不通', color: '#9ca3af', bg: '#f3f4f6' },
    { value: 'withdrawn', label: '退会', color: '#57534e', bg: '#e7e5e4' }
];

const STATUS_MAP = {
    '入会済': 'joined',
    '入会済み': 'joined',
    '休会': 'suspended',
    '休会中': 'suspended',
    '不承認': 'declined',
    '退会': 'withdrawn',
    '音信不通': 'unresponsive',
    '検討【架電予定】': 'considering_outgoing',
    '検討【入電予定】': 'considering_incoming',
    '長期検討客': 'considering_longterm',
    '問い合わせ': 'inquiry_received',
    '': 'inquiry_received'
};

const TEACHER_RATES = {
    '平井': 2500,
    '末永': 2000,
    '江塚': 1500,
    '鈴木': 1200,
    '川井': 1200,
    '清水': 1200,
    '敦子': 1200,
    '落合': 1200,
    '加藤': 1200,
    '島田': 1200
};

// Wage Calculation Logic
const getWageRate = (teacher, day, course) => {
    // Exclude Owners/Managers
    if (['平井', '末永'].includes(teacher)) return 0;

    const isSaturday = day === '土';
    const isExam = course && course.includes('受験');

    if (isSaturday) {
        return isExam ? 1350 : 1300;
    } else {
        return isExam ? 1300 : 1250;
    }
};

// --- Email Templates ---
const EMAIL_TEMPLATES = {
    trial_confirmation: {
        label: "体験レッスンのご案内",
        subject: (s) => `【チャイルド・アイズ】本日はお電話ありがとうございました｜体験レッスンのご案内`,
        body: (s) => `
${s.parentName} 様

本日はお電話いただき、誠にありがとうございました。
チャイルド・アイズ本郷三丁目校です。

体験レッスンのご予約を承りましたので、改めてご案内させていただきます。

◆ 体験レッスン日時
・日時：${s.trialDate ? new Date(s.trialDate).toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' }) : '〇月〇日（〇）〇時〇分'}～
・場所：チャイルド・アイズ本郷三丁目校
・持ち物：上履き（もしあれば）・お飲み物

お電話でお話しさせていただいた${s.parentName}様のお子様への想いを伺い、私たちもぜひお力になりたいという気持ちが一層強くなりました。当日、お子様の笑顔と「できた！」という喜びの瞬間をご一緒に見守れることを楽しみにしております。

◆ 体験前にぜひご覧ください
お電話でも少しお話しさせていただきましたが、チャイルド・アイズの教育について、より詳しくご理解いただける資料をご案内いたします。

・チャイルド・アイズの教育理念やメソッドを紹介した特集記事
「考える力」を育むための具体的な取り組みや、私たちが大切にしている想いをご紹介しています。
https://resemom.jp/article/2024/12/23/80053.html

・実際に通っている生徒さんのインタビュー動画
保護者の方の生の声や、お子様の成長の様子をご覧いただけます。「体験レッスンではこんなことができるんだ」というイメージも湧くかと思います。
https://www.youtube.com/watch?v=7dAV0_IVDUs

事前にご覧いただくことで、体験レッスンがより充実したものになると思いますので、お時間のある時にぜひお目通しください。

◆ 当日について
・お子様のペースに合わせて、楽しく進めてまいります
・終了後、お時間をとってご質問やご相談にもお答えいたします
何かご不明な点や、当日までにお聞きになりたいことがございましたら、いつでもお気軽にお問い合わせください。
スタッフ一同、${s.parentName}様とお子様にお会いできる日を心より楽しみにしております。
`.trim()
    },
    default: {
        label: "標準 (お問い合わせ御礼)",
        subject: (s) => `お問い合わせありがとうございます`,
        body: (s) => `
${s.parentName} 様

この度は、お問い合わせいただきありがとうございます。
幼児教室の平井です。

（本文を入力してください）`.trim()
    },
    trial_thankyou: {
        label: "体験後のお礼",
        subject: (s) => `【御礼】体験レッスンにご参加いただきありがとうございます`,
        body: (s) => `
${s.parentName} 様

いつも大変お世話になっております。
幼児教室の平井です。
`.trim()
    },
    longterm_followup: {
        label: "長期検討中の方へ (半年経過)",
        subject: (s) => `【重要】${s.name}様の学習状況についてのご相談`,
        body: (s) => `
${s.parentName} 様

いつも大変お世話になっております。
幼児教室の平井です。

以前お問い合わせをいただいてから、半年ほどが経過いたしました。
その後、${s.name}様のご様子はいかがでしょうか？
`.trim()
    }
};

// --- Initialization & Auth ---

function init() {
    window.addEventListener('hashchange', handleRoute);
    if (globalSearch) globalSearch.addEventListener('input', handleGlobalSearch);

    // Allowed Emails Whitelist
    const ALLOWED_EMAILS = [
        'hyiarhaoio@gmail.com',
        'contact@ce-hongo.com'
    ];

    // Auth Listener
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            // Check Whitelist
            if (!ALLOWED_EMAILS.includes(user.email)) {
                alert("このメールアドレスはこのシステムへのアクセス権限がありません。");
                await signOut(auth);
                return;
            }

            // Logged In
            state.user = user;
            loginOverlay.style.display = 'none';
            appContainer.style.display = 'flex';


            // Update Profile UI
            if (userAvatar) userAvatar.textContent = user.email[0].toUpperCase();
            if (userName) userName.textContent = user.displayName || user.email;

            // Start Data Listeners
            startDataSync();

            // Initial Route
            if (!window.location.hash) {
                window.location.hash = '#dashboard';
            } else {
                handleRoute();
            }

        } else {
            // Logged Out
            state.user = null;
            loginOverlay.style.display = 'flex';
            appContainer.style.display = 'none';

            // Generate clean login UI
            loginOverlay.querySelector('h1').textContent = 'Classroom CRM';

            // Unsubscribe listeners
            state.listeners.forEach(unsub => unsub());
            state.listeners = [];
        }
    });

    // Login Action
    loginBtn.addEventListener('click', async () => {
        try {
            await signInWithPopup(auth, provider);
        } catch (error) {
            console.error(error);
            loginError.textContent = "ログインに失敗しました: " + error.message;
            loginError.style.display = 'block';
        }
    });

    // Logout Action
    logoutBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        try {
            await signOut(auth);
            window.location.reload();
        } catch (error) {
            console.error(error);
        }
    });
}


// --- Data Synchronization (Firestore) ---

function startDataSync() {
    // 1. Students Sync
    const studentsUnsub = onSnapshot(collection(db, "students"), (snapshot) => {
        // Determine if this is the first data load
        const isInitialLoad = state.students.length === 0;

        state.students = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));

        // Initial Data Check for Migration
        if (isInitialLoad && snapshot.docs.length === 0) {
            checkAndMigrateData();
        }

        // Re-render current view when data updates
        if (state.view === 'dashboard' || state.view === 'students' || (isInitialLoad && state.students.length > 0)) {
            handleRoute();
        } else if (state.view === 'detail' || state.view === 'edit') {
            // Optional: If we want real-time updates on detail/edit but fear overwriting inputs:
            // For now, allow initial load to fix the blank screen.
        }
    }, (error) => {
        console.error("Firebase read error (students):", error);
        const ce = document.getElementById('content-area');
        if (ce) ce.innerHTML = `<div style="padding:2rem; color:red;">Firebaseデータの読み込みに失敗しました (students):<br>${error.message}</div>`;
    });
    state.listeners.push(studentsUnsub);

    // 2. Schools Sync
    const schoolsUnsub = onSnapshot(collection(db, "schools"), (snapshot) => {
        state.schools = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));

        if (state.schools.length === 0) {
            // Optional: load default schools if completely empty
            // checkAndMigrateSchools(); // Let's handle generic migration together
        }
    });
    state.listeners.push(schoolsUnsub);

    // 3. Email Templates Sync
    const tmplUnsub = onSnapshot(collection(db, "mail_templates"), (snapshot) => {
        state.customTemplates = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
        // If currently viewing email draft, update the select options dynamically
        const tmplSelect = document.getElementById('template-select');
        if (tmplSelect) {
            const currentVal = tmplSelect.value;
            // Re-render select options
            tmplSelect.innerHTML = `
                <option value="">テンプレートを選択...</option>
                <optgroup label="システム標準">
                    ${Object.keys(EMAIL_TEMPLATES).map(k => `<option value="${k}">${EMAIL_TEMPLATES[k].label}</option>`).join('')}
                </optgroup>
                ${state.customTemplates.length > 0 ? `<optgroup label="作成済みテンプレート">
                    ${state.customTemplates.map(t => `<option value="${t.id}">${t.label}</option>`).join('')}
                </optgroup>` : ''}
            `;
            tmplSelect.value = currentVal;
        }
    });
    state.listeners.push(tmplUnsub);
}

// --- Migration Logic ---
async function checkAndMigrateData() {
    const localData = localStorage.getItem('classroom_crm_data_v2');
    const localSchools = localStorage.getItem('classroom_crm_schools_v1');

    if (localData || localSchools) {
        if (confirm('以前のデータ（ローカル保存）が見つかりました。\nこれをクラウドデータベースに移行しますか？\n（移行後は他のPCからもデータが見られるようになります）')) {
            try {
                // Students Migration
                if (localData) {
                    const students = JSON.parse(localData);
                    let count = 0;
                    for (const s of students) {
                        // Use setDoc to preserve ID, or addDoc for new ID. 
                        // To preserve '#detail/STxxx' links, we MUST preserve IDs.
                        await setDoc(doc(db, "students", s.id), s);
                        count++;
                    }
                    console.log(`Migrated ${count} students.`);
                }

                // Schools Migration
                if (localSchools) {
                    const schools = JSON.parse(localSchools);
                    for (const sch of schools) {
                        await setDoc(doc(db, "schools", sch.id), sch);
                    }
                } else {
                    // Initialize Default Schools if no local data
                    const SCHOOL_DEFAULT_DATA = [
                        { id: 'SCH001', name: 'さくら幼稚園', keywords: ['さくら'], policy: 'のびのびとした教育', description: '自然体験重視' },
                        { id: 'SCH002', name: 'ひまわり保育園', keywords: ['ひまわり'], policy: '規律と協調性', description: 'モンテッソーリ' },
                        { id: 'SCH003', name: '若葉幼稚園', keywords: ['若葉'], policy: 'お受験対応', description: '知育重視' }
                    ];
                    for (const sch of SCHOOL_DEFAULT_DATA) {
                        await setDoc(doc(db, "schools", sch.id), sch);
                    }
                }

                alert('データの移行が完了しました！\nブラウザに残った古いデータは削除されます。');
                localStorage.removeItem('classroom_crm_data_v2');
                localStorage.removeItem('classroom_crm_schools_v1');

            } catch (e) {
                console.error("Migration Failed", e);
                alert("移行中にエラーが発生しました。\n" + e.message);
            }
        }
    }
}


// --- CRUD Operations (Async) ---

async function addStudent(studentData) {
    // Generate an ID similar to old format or let Firestore do it.
    // If we let Firestore do it, ID will be random.
    // Let's use Firestore IDs for new data, it is cleaner.
    const docRef = await addDoc(collection(db, "students"), {
        ...studentData,
        updatedAt: new Date().toISOString()
    });
    return docRef.id;
}

async function updateStudent(id, updatedData) {
    const studentRef = doc(db, "students", id);
    await updateDoc(studentRef, {
        ...updatedData,
        updatedAt: new Date().toISOString()
    });
}

async function deleteStudent(id) {
    if (confirm('本当に削除しますか？\nこの操作は取り消せません。')) {
        try {
            await deleteDoc(doc(db, "students", id));
            window.location.hash = '#students';
        } catch (e) {
            console.error("Delete failed:", e);
            alert("削除に失敗しました: " + e.message);
        }
    }
}

// School CRUD
async function addSchool(schoolData) {
    const docRef = await addDoc(collection(db, "schools"), {
        ...schoolData,
        updatedAt: new Date().toISOString()
    });
    return docRef.id;
}

async function updateSchool(id, data) {
    await updateDoc(doc(db, "schools", id), {
        ...data,
        updatedAt: new Date().toISOString()
    });
}

async function deleteSchool(id) {
    if (confirm('この園情報を削除しますか？')) {
        try {
            await deleteDoc(doc(db, "schools", id));
            renderSchoolList(); // will auto-update via listener, but good to trigger
        } catch (e) {
            console.error("Delete failed:", e);
            alert("削除に失敗しました: " + e.message);
        }
    }
}

// --- Routing ---
function handleRoute() {
    // Reset View Classes
    document.body.classList.remove('view-dashboard', 'view-students', 'view-share');

    const hash = window.location.hash.replace('#', '');
    const parts = hash.split('/');
    const route = parts[0] || 'dashboard';
    const param = parts[1] || null;
    const action = parts[2] || null;

    if (route !== 'students') { state.filterStatus = null; }
    state.view = route;
    state.currentId = param;

    if (route === 'share') {
        document.body.classList.add('view-share');
    }

    navItems.forEach(item => {
        item.classList.remove('active');
        if (item.getAttribute('href') === `#${route}`) {
            item.classList.add('active');
        }
    });

    try {
        switch (route) {
            case 'dashboard': renderDashboard(); break;
            case 'students': renderStudentList(); break;
            case 'analytics': renderAnalytics(); break;
            case 'add': renderForm(); break;
            case 'edit': renderForm(state.currentId); break;
            case 'detail': renderDetail(state.currentId, action); break;
            case 'share': renderDetail(state.currentId, null, true); break; // Read-Only View
            case 'email': renderEmailDraft(state.currentId); break;
            case 'schools': renderSchoolList(); break;
            case 'school_edit': renderSchoolForm(state.currentId); break;
            case 'calendar': renderCalendar(); break;
            case 'instructor_analytics': renderInstructorAnalytics(); break;
            case 'iq_list': renderIqList(); break; // New IQ List route
            default: renderDashboard();
        }

        // 画面遷移時にスクロール位置を一番上に戻す (ブラウザの自動スクロール復元を上書きするため少し遅延させる)
        setTimeout(() => {
            if (contentArea) contentArea.scrollTop = 0;
            window.scrollTo(0, 0);
        }, 50);

    } catch (e) {
        console.error("Render Error:", e);
        contentArea.innerHTML = `<div style="padding:2rem; color:red;">エラーが発生しました。<br>${e.message}</div>`;
    }
}

// --- Global Search ---
// --- Global Search ---
function handleGlobalSearch(e) {
    const term = e.target.value;
    state.searchQuery = term;

    // If we are not on the students list, go there
    if (state.view !== 'students') {
        window.location.hash = '#students';
        return;
    }

    // If we are already on students list, trigger the list filter directly
    const listSearch = document.getElementById('list-search');
    if (listSearch) {
        listSearch.value = term;
        listSearch.dispatchEvent(new Event('input'));
    }
}

// --- Global Helpers needed for Inline Events ---
window.filterAndGo = function (filterType) {
    state.filterStatus = filterType;
    window.location.hash = '#students';
};
window.deleteStudent = deleteStudent;
window.deleteSchool = deleteSchool;
window.changeStatus = async function (id, newStatus) {
    const s = state.students.find(x => x.id === id);
    if (s) {
        const update = { status: newStatus };
        if (newStatus === 'joined' && !s.joinedDate) {
            update.joinedDate = new Date().toISOString().split('T')[0];
        }
        await updateStudent(id, update);
        // In local version, we need to re-render manually if on dashboard
        if (state.view === 'dashboard') renderDashboard();
    }
}
window.applyFilters = function () {
    state.filterClass = document.getElementById('filter-course').value;
    state.filterStatus = document.getElementById('filter-status').value;
    renderStudentList();
};
window.copyToClipboard = function (text) {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
        alert('クリップボードにコピーしました');
    }).catch(err => {
        console.error('Failed to copy: ', err);
        alert('コピーに失敗しました');
    });
};

window.resetFilters = function () { state.filterClass = null; state.filterStatus = null; renderStudentList(); };

window.triggerCSVImport = function () { document.getElementById('csv-upload').click(); }
window.handleCSVUpload = function (event) {
    const file = event.target.files[0];
    if (!file) return;

    // Reset so same file can be selected again
    event.target.value = '';

    Papa.parse(file, {
        header: false,
        skipEmptyLines: true,
        complete: async function (results) {
            const rows = results.data;
            if (rows.length === 0) return;

            let importedCount = 0;
            let updatedCount = 0;

            // Check if it's our new comprehensive backup format
            const isBackupFormat = rows[0][0] === 'ID' && rows[0][1] === '氏名';

            if (confirm(`CSVファイルから${isBackupFormat ? rows.length - 1 : rows.length}件のデータを読み込みました。インポートを開始しますか？\n（既存の生徒データは${isBackupFormat ? '「ID」または' : ''}「名前」で照合して上書き更新されます）`)) {

                const startIndex = isBackupFormat ? 1 : 0;

                for (let i = startIndex; i < rows.length; i++) {
                    const row = rows[i];
                    let studentData = {};
                    let existingStudent = null;

                    if (isBackupFormat) {
                        const id = row[0];
                        const name = row[1];
                        if (!name) continue;

                        if (id) {
                            existingStudent = state.students.find(s => s.id === id);
                        }
                        if (!existingStudent) {
                            existingStudent = state.students.find(s => s.name === name || s.name.replace(/\s+/g, '') === name.replace(/\s+/g, ''));
                        }

                        const courses = row[15] ? row[15].split(',').map(s => s.trim()).filter(Boolean) : [];
                        const tags = row[16] ? row[16].split(',').map(s => s.trim()).filter(Boolean) : [];

                        studentData = {
                            name: name,
                            kana: row[2] || '',
                            status: row[3] || 'inquiry_received',
                            inquiryDate: row[4] || '',
                            joinedDate: row[5] || '',
                            withdrawalDate: row[6] || '',
                            phone: row[7] || '',
                            email: row[8] || '',
                            parentName: row[9] || '',
                            parentWork: row[10] || '',
                            address: row[11] || '',
                            gender: row[12] || '',
                            birthday: row[13] || '',
                            school: row[14] || '',
                            courses: courses,
                            classCategory: courses[0] || '',
                            tags: tags,
                            handler: row[17] || '',
                            instructor: row[18] || '',
                            interviewer: row[19] || '',
                            trialDate: row[20] || '',
                            inquiryReason: row[21] || '',
                            concerns: row[22] || '',
                            preferredSchedule: row[23] || '',
                            partnerAttendance: row[24] || '',
                            personality: row[25] || '',
                            lessons: row[26] || '',
                            siblings: row[27] || '',
                            memo: row[28] || '',
                            updatedAt: new Date().toISOString()
                        };
                    } else {
                        // Legacy CRM import format
                        const inquiryDateRaw = row[1];
                        const nameRaw = row[4];

                        if (!nameRaw || !inquiryDateRaw) continue;
                        if (nameRaw.includes('名前')) continue;

                        const nameParts = nameRaw.split(/[\n\r]+/);
                        const name = nameParts[0].trim();
                        const kana = nameParts.length > 1 ? nameParts[1].trim() : (row[10] || '');

                        existingStudent = state.students.find(s => s.name === name || s.name.replace(/\s+/g, '') === name.replace(/\s+/g, ''));

                        const inquiryDate = inquiryDateRaw.replace(/年/g, '-').replace(/月/g, '-').replace(/日/g, '');
                        let joinedDate = row[2] ? row[2].replace(/\//g, '-') : null;
                        if (joinedDate && joinedDate.length <= 7) joinedDate += '-01';

                        const gender = row[6] === '男' ? 'boy' : (row[6] === '女' ? 'girl' : '');
                        const memo = (row[9] || '') + '\n' + (row[8] || '');
                        const birthday = row[11] ? row[11].split('\n')[0] : '';
                        const school = row[13];
                        const parentNameRaw = row[14] ? row[14].split(/[\n\r]+/) : [];
                        const parentName = parentNameRaw[0];
                        const parentWork = row[16] ? row[16].replace(/[\n\r]+/g, ' ') : '';
                        const phone = row[17] ? row[17].replace(/['’]/g, '').replace(/[\n\r]+/g, ', ') : '';
                        const email = row[18];
                        const address = (row[19] || '') + (row[20] || '') + (row[21] || '');
                        const statusRaw = row[5];
                        const status = STATUS_MAP[statusRaw] || 'inquiry_received';

                        const courses = [];
                        const courseRaw = row[3] || '';
                        if (courseRaw.includes('CE')) courses.push('知育');
                        if (courseRaw.includes('HA')) courses.push('HALLO');

                        studentData = {
                            inquiryDate: inquiryDate,
                            name: name,
                            kana: kana,
                            gender: gender,
                            courses: courses,
                            birthday: birthday,
                            school: school,
                            parentName: parentName,
                            parentWork: parentWork,
                            phone: phone,
                            email: email,
                            address: address,
                            memo: memo,
                            status: status,
                            joinedDate: joinedDate,
                            updatedAt: new Date().toISOString()
                        };
                    }

                    Object.keys(studentData).forEach(key => studentData[key] === undefined && delete studentData[key]);

                    if (existingStudent) {
                        await updateStudent(existingStudent.id, studentData);
                        updatedCount++;
                    } else {
                        await addStudent(studentData);
                        importedCount++;
                    }
                }
                alert(`インポート完了:\n新規: ${importedCount}件\n更新: ${updatedCount}件`);
                window.location.hash = '#students';
            }
        }
    });
};

window.exportToCSV = function () {
    const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
    const header = [
        "ID", "氏名", "フリガナ", "ステータス", "問い合わせ日", "入会日", "退会日",
        "電話番号", "Email", "保護者名", "保護者勤務先", "住所",
        "性別", "生年月日", "在籍園", "コース", "タグ",
        "担当者", "担当インストラクター", "入会面談者", "体験日時",
        "問い合わせ経緯", "不安・懸念", "希望曜日時間", "来校時同伴",
        "性格", "習い事", "兄弟", "メモ"
    ];

    // Sort students appropriately (e.g. by created/updated time, or just currently displayed list)
    // We'll export all current state.students
    const rows = state.students.map(s => [
        s.id || '', s.name || '', s.kana || '', s.status || '', s.inquiryDate || '', s.joinedDate || '', s.withdrawalDate || '',
        s.phone || '', s.email || '', s.parentName || '', s.parentWork || '', s.address || '',
        s.gender || '', s.birthday || '', s.school || '', (s.courses || []).join(','), (s.tags || []).join(','),
        s.handler || '', s.instructor || '', s.interviewer || '', s.trialDate || '',
        s.inquiryReason || '', s.concerns || '', s.preferredSchedule || '', s.partnerAttendance || '',
        s.personality || '', s.lessons || '', s.siblings || '', s.memo || ''
    ]);

    const csvContent = [header, ...rows].map(e => e.map(f => `"${String(f || '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([bom, csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `students_export_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
};

window.mailToFiltered = function () {
    const targets = state.currentFilteredList || [];
    const emails = targets.map(s => s.email).filter(e => e && e.includes('@')); // Simple validation

    if (emails.length === 0) {
        alert('メールアドレスを持つ対象者がいません。');
        return;
    }

    const uniqueEmails = [...new Set(emails)]; // Remove duplicates

    if (confirm(`${uniqueEmails.length}件のメールアドレスをBCCに設定してメーラーを起動しますか？`)) {
        // Gmail compose window with BCC
        const url = `https://mail.google.com/mail/?view=cm&fs=1&bcc=${encodeURIComponent(uniqueEmails.join(','))}`;
        window.open(url, '_blank');
    }
};

// --- Render Functions ---

function renderDashboard() {
    document.body.classList.add('view-dashboard');
    document.body.classList.remove('view-students');
    pageTitle.textContent = 'ダッシュボード';
    const students = state.students;

    // Logic Same as before
    const activeInquiries = students.filter(s =>
        ['inquiry_received', 'considering_incoming', 'considering_outgoing', 'considering_longterm'].includes(s.status)
    ).length;
    const trials = students.filter(s => s.status === 'trial_booked').length;
    const joined = students.filter(s => ['joined', 'suspended'].includes(s.status)).length;
    const prospects = students.filter(s => ['considering_longterm', 'declined', 'unresponsive'].includes(s.status)).length;

    // --- Calculate Total Revenue for Dashboard ---
    const joinedStudents = students.filter(s => ['joined', 'suspended'].includes(s.status));
    let totalRevenue = 0;
    const coursePrices = {
        'PDクラス': 13860,
        'Dクラス': 13860,
        'Tクラス': 13860,
        'Qクラス': 17325,
        'Cクラス': 17325,
        'Sクラス': 17325,
        '受験': 27720,
        'HALLO': 15000,
        'アストルム': 0
    };

    joinedStudents.forEach(s => {
        const courses = s.courses || (s.classCategory ? [s.classCategory] : []);
        if (courses.includes('HALLO')) totalRevenue += coursePrices['HALLO'];
        if (courses.includes('受験')) totalRevenue += coursePrices['受験'];
        if (courses.includes('アストルム')) totalRevenue += coursePrices['アストルム'];

        if (courses.includes('知育')) {
            const cls = calculateClass(s.birthday);
            if (cls && cls.name) {
                const rawName = cls.name.split(' ')[0]; // e.g. "Dクラス"
                if (coursePrices[rawName]) {
                    totalRevenue += coursePrices[rawName];
                }
            }
        }
    });
    const formatCurrency = (amount) => '¥' + amount.toLocaleString();

    contentArea.innerHTML = `
        <div class="stats-grid">
            <div class="stat-card clickable" onclick="filterAndGo('prospects_group')" style="border-left: 4px solid var(--primary); cursor: pointer;">
                <div class="stat-icon" style="background:#DBEAFE; color:var(--primary)">
                    <i class="ri-user-search-line"></i>
                </div>
                <div class="stat-info"><h3>長期見込客</h3><div class="number">${prospects}</div></div>
            </div>

            <div class="stat-card clickable" onclick="filterAndGo('trial_booked')" style="border-left: 4px solid var(--accent); cursor: pointer;">
                <div class="stat-icon" style="background:#FEF3C7; color:#B45309">
                    <i class="ri-calendar-check-line"></i>
                </div>
                <div class="stat-info"><h3>体験予約中</h3><div class="number">${trials}</div></div>
            </div>
            <div class="stat-card clickable" onclick="filterAndGo('joined')" style="border-left: 4px solid var(--status-joined-text); cursor: pointer;">
                <div class="stat-icon" style="background:var(--status-joined-bg); color:var(--status-joined-text)">
                    <i class="ri-thumb-up-line"></i>
                </div>
                <div class="stat-info"><h3>入会済み</h3><div class="number">${joined}</div></div>
            </div>
            <div class="stat-card clickable" onclick="window.location.hash='#analytics'" style="border-left: 4px solid #10b981; cursor: pointer;">
                <div class="stat-icon" style="background:#D1FAE5; color:#059669">
                    <i class="ri-money-dollar-circle-line"></i>
                </div>
                <div class="stat-info"><h3>売上目安</h3><div class="number">${formatCurrency(totalRevenue)}</div><div style="font-size:0.8rem; color:var(--text-muted); margin-top:0.2rem;">(月額算定)</div></div>
            </div>
        </div>

        <div class="data-table-container">
            <div style="padding: 1.5rem; border-bottom: 1px solid var(--border);">
                <h3 style="font-size: 1.1rem;">要対応・状況確認リスト</h3>
            </div>
            <table>
                <thead>
                    <tr>
                        <th>生徒名</th><th>コース</th><th>ステータス</th><th>問い合わせ経過日数</th><th>連絡先</th><th>メール連絡</th><th>面談担当</th>
                    </tr>
                </thead>
                <tbody>${renderAttentionList(state.students)}</tbody>
            </table>
        </div>
    `;
}

function renderAttentionList(list) {
    const today = new Date();
    // Removed 'considering_longterm' from attention list as requested
    const targetStatuses = ['inquiry_received', 'considering_incoming', 'considering_outgoing', 'trial_booked'];
    // Filter out 'declined' explicitly just in case, though not in targetStatuses
    const attentionList = list.filter(s => s.status && targetStatuses.includes(s.status) && s.status !== 'declined').sort((a, b) => {
        const da = a.inquiryDate ? new Date(a.inquiryDate).getTime() || 0 : 0;
        const db = b.inquiryDate ? new Date(b.inquiryDate).getTime() || 0 : 0;
        return da - db;
    });

    if (attentionList.length === 0) return '<tr><td colspan="7" style="text-align: center; padding: 2rem; color: #aaa;">対応が必要な生徒はいません 🎉</td></tr>';

    return attentionList.map(s => {
        const cls = calculateClass(s.birthday);
        const inquiryTime = s.inquiryDate ? new Date(s.inquiryDate) : today;
        const diffDays = isNaN(inquiryTime) ? 0 : Math.ceil(Math.abs(today - inquiryTime) / (1000 * 60 * 60 * 24));
        let daysDisplay = diffDays > 30 ? `<span style="font-weight:bold; color:#c2410c;">${diffDays}日 (長期)</span>` : `<span style="font-weight:bold; color:var(--text-color);">${diffDays}日</span>`;

        const statusStyle = STATUS_DEFINITIONS.find(d => d.value === s.status) || { color: '#333', bg: '#fff' };
        const statusSelect = `
            <select onclick="event.stopPropagation()" onchange="changeStatus('${s.id}', this.value)" class="status-select"
                style="padding:0.2rem 0.5rem; border:1px solid ${statusStyle.color}; border-radius:0.25rem; font-size:0.85rem; background:${statusStyle.bg}; color:${statusStyle.color}; cursor:pointer; font-weight:500;">
                ${STATUS_DEFINITIONS.map(opt => `<option value="${opt.value}" ${s.status === opt.value ? 'selected' : ''}>${opt.label}</option>`).join('')}
            </select>
        `;

        // Courses logic
        let courses = s.courses || (s.classCategory ? [s.classCategory] : []);
        if (typeof courses === 'string') courses = [courses];
        if (!Array.isArray(courses)) courses = [];
        let badgesHTML = '';
        if (courses.includes('知育')) {
            const rawClass = cls.name.split(' ')[0];
            const ageClass = rawClass.replace('クラス', '') + '知育';
            badgesHTML += `<span class="badge" style="background:#fef9c3; color:#854d0e; border:1px solid #fde047; font-weight:bold;">${ageClass}</span>`;
        }
        if (courses.includes('HALLO')) badgesHTML += `<span class="badge" style="background:#dbeafe; color:#1e40af; border:1px solid #93c5fd; font-weight:bold;">HALLO</span>`;
        if (courses.includes('受験')) badgesHTML += `<span class="badge" style="background:#fee2e2; color:#991b1b; border:1px solid #fca5a5; font-weight:bold;">受験</span>`;
        if (courses.includes('アストルム')) badgesHTML += `<span class="badge" style="background:#f3e8ff; color:#6b21a8; border:1px solid #d8b4fe; font-weight:bold;">アストルム</span>`;
        if (courses.includes('IQテスト')) badgesHTML += `<span class="badge" style="background:#ccfbf1; color:#0f766e; border:1px solid #99f6e4; font-weight:bold;">IQ</span>`;

        return `
        <tr onclick="window.location.hash='#detail/${s.id}'" style="cursor: pointer;">
            <td style="font-weight: 500;">${s.name}<div style="font-size:0.75rem; color:#64748b;">${s.kana || ''}</div></td>
            <td><div style="display:flex; flex-wrap:wrap; gap:4px;">${badgesHTML}</div></td>
            <td>${statusSelect}</td>
            <td>
                ${daysDisplay}
                <button class="btn-secondary" style="padding:0.2rem 0.5rem; font-size:0.75rem; margin-top:0.25rem; display:block;" onclick="event.stopPropagation(); window.location.hash='#detail/${s.id}/trial-memo'">
                    <i class="ri-file-edit-line"></i> 体験後メモ
                </button>
            </td>
            <td><div style="font-family:monospace; font-size:0.9rem;">${s.phone || '-'}</div></td>
            <td><button class="btn-primary" style="padding:0.25rem 0.5rem; font-size:0.75rem;" onclick="event.stopPropagation(); window.location.hash='#email/${s.id}'">メール</button></td>
            <td>${s.interviewer || '-'}</td>
        </tr>`;
    }).join('');
}
window.changeStatus = async function (id, newStatus) {
    if (newStatus === 'withdrawn') {
        state.pendingStatus = 'withdrawn';
        window.location.hash = `#edit/${id}`;
        return;
    }
    const s = state.students.find(x => x.id === id);
    if (s) {
        const update = { status: newStatus };
        if (newStatus === 'joined' && !s.joinedDate) {
            update.joinedDate = new Date().toISOString().split('T')[0];
        }
        await updateStudent(id, update);
    }
}

function renderStudentList() {
    document.body.classList.add('view-students');
    document.body.classList.remove('view-dashboard');
    pageTitle.textContent = '生徒管理';
    // --- Filter Logic ---
    const filterAndRender = () => {
        let displayList = [...state.students];

        // 1. Status Filter
        if (state.filterStatus) {
            if (state.filterStatus === 'considering') displayList = displayList.filter(s => s.status && s.status.startsWith('considering'));
            else if (state.filterStatus === 'joined') displayList = displayList.filter(s => ['joined', 'suspended'].includes(s.status));
            else if (state.filterStatus === 'other') displayList = displayList.filter(s => s.status && ['declined', 'unresponsive'].includes(s.status));
            else if (state.filterStatus === 'prospects_group') displayList = displayList.filter(s => ['considering_longterm', 'declined', 'unresponsive'].includes(s.status));
            else displayList = displayList.filter(s => s.status === state.filterStatus);
        }

        // 2. Class/Course Filter
        if (state.filterClass) {
            displayList = displayList.filter(s => {
                const courses = s.courses || (s.classCategory ? [s.classCategory] : []);
                if (state.filterClass.startsWith('知育_')) {
                    if (!courses.includes('知育')) return false;
                    const targetAgeClass = state.filterClass.replace('知育_', '');
                    const cls = calculateClass(s.birthday);
                    return cls.name.startsWith(targetAgeClass);
                }
                return courses.includes(state.filterClass);
            });
        }

        // 3. Tag Filter
        if (state.filterTag) {
            const tagTerm = state.filterTag.toLowerCase();
            displayList = displayList.filter(s => (s.tags || []).some(t => t.toLowerCase().includes(tagTerm)));
        }

        // 4. Keyword Search
        if (state.searchQuery) {
            const term = state.searchQuery.toLowerCase();
            displayList = displayList.filter(s =>
                (s.name && s.name.toLowerCase().includes(term)) ||
                (s.kana && s.kana.toLowerCase().includes(term)) ||
                (s.parentName && s.parentName.toLowerCase().includes(term))
            );
        }

        // Sort
        displayList.sort((a, b) => new Date(b.inquiryDate) - new Date(a.inquiryDate));

        // Update State & UI
        state.currentFilteredList = displayList;

        const tbody = document.querySelector('#students-table tbody');
        if (tbody) tbody.innerHTML = renderTableRows(displayList);

        const countEl = document.getElementById('student-count-display');
        if (countEl) countEl.textContent = `${displayList.length} / ${state.students.length}件`;
    };

    // --- Render Container ---
    contentArea.innerHTML = `
        <div class="data-table-container">
            <div style="padding: 1.5rem; display: flex; flex-wrap: wrap; gap: 1rem; align-items: center; justify-content: space-between; background: #f8fafc; border-bottom: 1px solid var(--border);">
                <div style="display:flex; gap:0.5rem; flex: 1; min-width: 250px;">
                    <input type="text" id="list-search" placeholder="名前で検索..." value="${state.searchQuery || ''}" style="padding:0.5rem; border:1px solid #ccc; width:100%; border-radius:0.5rem;">
                     <input type="text" id="filter-tag" placeholder="タグで絞り込み" value="${state.filterTag || ''}" style="padding:0.5rem; border:1px solid #ccc; width:150px; border-radius:0.5rem;">
                </div>
                <div style="display:flex; gap:1rem; align-items:center;">
                    <div id="student-count-display" style="font-size:0.85rem; color:#64748b;">Loading...</div>
                     <select id="filter-course" onchange="applyFilters()" style="padding:0.5rem; border-radius:0.5rem;">
                        <option value="">全コース</option>
                        <option value="知育_PD">PD(知育)</option>
                        <option value="知育_D">D(知育)</option>
                        <option value="知育_T">T(知育)</option>
                        <option value="知育_Q">Q(知育)</option>
                        <option value="知育_C">C(知育)</option>
                        <option value="知育_S">S(知育)</option>
                        <option value="HALLO">HALLO</option>
                        <option value="受験">受験</option>
                        <option value="アストルム">アストルム</option>
                        <option value="IQテスト">IQテスト</option>
                    </select>
                    <select id="filter-status" onchange="applyFilters()" style="padding:0.5rem; border-radius:0.5rem;">
                        <option value="">全ステータス</option>
                        <option value="inquiry_received">問い合わせ</option>
                        <option value="considering">検討中</option>
                        <option value="trial_booked">体験予約</option>
                        <option value="joined">入会済</option>
                        <option value="suspended">休会中</option>
                        <option value="withdrawn">退会</option>
                    </select>
                    <!-- Search buttons removed as they are now instant/on-change, but kept Clear -->
                    <button class="btn-secondary" onclick="resetFilters()">クリア</button>
                    <div style="width:1px; height:24px; background:#cbd5e1; margin:0 0.5rem;"></div>
                    <button class="btn-primary" onclick="mailToFiltered()" title="表示中のメンバーに一括メール" style="background:#0F9D58; border-color:#0F9D58;"><i class="ri-mail-send-fill"></i> 一括メール</button>
                    <button class="btn-secondary" onclick="exportToCSV()" title="CSVダウンロード"><i class="ri-file-download-line"></i></button>
                    <button class="btn-secondary" onclick="triggerCSVImport()" title="CSVインポート" style="background:#e0f2fe; color:#0369a1; border:1px solid #7dd3fc;"><i class="ri-file-upload-line"></i></button>
                    <input type="file" id="csv-upload" style="display:none" accept=".csv" onchange="handleCSVUpload(event)">
                </div>
            </div>
            <table id="students-table">
                <thead><tr><th>問合日</th><th>入会期間</th><th style="min-width: 180px;">生徒名</th><th>生年月日</th><th>コース</th><th>ステータス</th><th>入会後メモ</th><th>連絡先</th><th>面談担当</th><th></th></tr></thead>
                <tbody></tbody>
            </table>
        </div>
    `;

    // Initialize inputs
    if (state.filterClass) document.getElementById('filter-course').value = state.filterClass;
    if (state.filterStatus) document.getElementById('filter-status').value = state.filterStatus;

    // Attach Listeners
    const searchInput = document.getElementById('list-search');
    searchInput.addEventListener('input', (e) => {
        state.searchQuery = e.target.value;
        filterAndRender(); // Incremental search without focus loss!
    });

    const tagInput = document.getElementById('filter-tag');
    tagInput.addEventListener('input', (e) => {
        state.filterTag = e.target.value;
        filterAndRender();
    });

    // Override global helper to use local render
    window.applyFilters = function () {
        state.filterClass = document.getElementById('filter-course').value;
        state.filterStatus = document.getElementById('filter-status').value;
        filterAndRender();
    };

    // Initial Render
    filterAndRender();
}
window.resetFilters = function () { state.filterClass = null; state.filterStatus = null; renderStudentList(); };

function renderTableRows(list) {
    if (list.length === 0) return '<tr><td colspan="9" style="text-align: center; padding: 2rem;">データがありません</td></tr>';
    return list.map(s => {
        const cls = calculateClass(s.birthday);
        const duration = s.joinedDate ? calculateEnrollmentDuration(s.joinedDate) : '-';
        let courses = s.courses || (s.classCategory ? [s.classCategory] : []);
        if (typeof courses === 'string') courses = [courses];
        if (!Array.isArray(courses)) courses = [];

        let badgesHTML = '';
        if (courses.includes('知育')) badgesHTML += `<span class="badge" style="background:#fef9c3; color:#854d0e;">${cls.name.split(' ')[0].replace('クラス', '')}知育</span>`;
        if (courses.includes('HALLO')) badgesHTML += `<span class="badge" style="background:#dbeafe; color:#1e40af;">HALLO</span>`;
        if (courses.includes('受験')) badgesHTML += `<span class="badge" style="background:#fee2e2; color:#991b1b;">受験</span>`;
        if (courses.includes('アストルム')) badgesHTML += `<span class="badge" style="background:#f3e8ff; color:#6b21a8;">アスト</span>`;
        if (courses.includes('IQテスト')) badgesHTML += `<span class="badge" style="background:#ccfbf1; color:#0f766e;">IQ</span>`;

        // Tag Badges
        let tagsObj = s.tags || [];
        if (typeof tagsObj === 'string') tagsObj = tagsObj.split(',').map(x => x.trim());
        if (Array.isArray(tagsObj) && tagsObj.length > 0) {
            badgesHTML += tagsObj.map(t => `<span class="badge" style="background:#e2e8f0; color:#475569; font-size:0.75rem;"><i class="ri-price-tag-3-line" style="margin-right:2px;"></i>${t}</span>`).join('');
        }

        const statusStyle = STATUS_DEFINITIONS.find(d => d.value === s.status) || { color: '#333', bg: '#fff' };
        const statusSelect = `
            <select onclick="event.stopPropagation()" onchange="changeStatus('${s.id}', this.value)" class="status-select"
                style="padding:0.2rem 0.5rem; border:1px solid ${statusStyle.color}; border-radius:0.25rem; font-size:0.85rem; background:${statusStyle.bg}; color:${statusStyle.color}; cursor:pointer; font-weight:500; appearance: none; -webkit-appearance: none;">
                ${STATUS_DEFINITIONS.map(opt => `<option value="${opt.value}" ${s.status === opt.value ? 'selected' : ''}>${opt.label}</option>`).join('')}
            </select>
        `;

        // Format birthday for display with Age and Months
        const birthdayDisplay = s.birthday ? (() => {
            const parts = s.birthday.split('-');
            if (parts.length === 3) {
                const bldate = new Date(s.birthday);
                const today = new Date();
                let y = today.getFullYear() - bldate.getFullYear();
                let m = today.getMonth() - bldate.getMonth();
                let d = today.getDate() - bldate.getDate();
                if (d < 0) m--;
                if (m < 0) { y--; m += 12; }
                const ageStr = `${y}歳${m}ヶ月`;

                return `${parts[0]}年${parseInt(parts[1])}月${parseInt(parts[2])}日<div style="font-size:0.75rem; color:#64748b; margin-top:2px;">${ageStr}</div>`;
            }
            return s.birthday;
        })() : '-';

        return `
        <tr onclick="window.location.hash='#detail/${s.id}'" style="cursor: pointer;">
            <td style="color:var(--text-muted); font-size:0.9rem;">${s.inquiryDate || '-'}</td>
            <td style="color:${s.joinedDate ? 'green' : '#666'}">${duration}</td>
            <td>${s.name}<div style="font-size:0.75rem;">${s.kana || ''}</div></td>
            <td style="font-size:0.85rem; color:#475569; white-space:nowrap;">${birthdayDisplay}</td>
            <td><div style="display:flex;gap:2px;flex-wrap:wrap;">${badgesHTML}</div></td>
            <td>${statusSelect}</td>
            <td>
                <button class="btn-secondary" style="padding:0.2rem 0.5rem; font-size:0.75rem; background-color: #8b5cf6; color: white; border: none;" onclick="event.stopPropagation(); window.location.hash='#detail/${s.id}/join-memo'">
                    <i class="ri-file-edit-line"></i> 入会後メモ
                </button>
            </td>
            <td>${String(s.phone || '-').split(',').slice(0, 2).join('<br>')}</td>
            <td>${s.interviewer || '-'}</td>
            <td><i class="ri-edit-line" onclick="event.stopPropagation(); window.location.hash='#edit/${s.id}'"></i></td>
        </tr>`;
    }).join('');
}

function renderForm(id = null) {
    const isEdit = !!id;
    const data = isEdit ? state.students.find(s => s.id === id) : {};
    pageTitle.textContent = isEdit ? '生徒情報の編集' : '新規生徒登録';

    contentArea.innerHTML = `
        <form id="student-form" class="form-container" novalidate>
             ${!isEdit ? `<div style="margin-bottom:2rem; background:#f0f9ff; padding:1.5rem; border:1px dashed #0284c7; border-radius:0.75rem;"><h3 style="font-size:1rem; color:#0369a1;"><i class="ri-magic-line"></i> お問い合わせメールから自動入力</h3><textarea id="magic-paste" rows="3" placeholder="ここにメール本文をペースト..." style="width:100%; border:1px solid #cbd5e1;"></textarea></div>` : ''}

            <div class="section-divider">受付情報</div>
            <div class="form-grid">
                 <div class="form-group"><label>問合わせ日</label><input type="date" name="inquiryDate" id="field-inquiryDate" value="${data.inquiryDate || new Date().toISOString().split('T')[0]}" required></div>
                  <div class="form-group"><label>問合せ担当</label>
                    <select name="handler" id="field-handler" required>
                        <option value="">選択</option>
                        <option value="平井" ${data.handler === '平井' ? 'selected' : ''}>平井</option>
                        <option value="末永" ${data.handler === '末永' ? 'selected' : ''}>末永</option>
                        <option value="加藤" ${data.handler === '加藤' ? 'selected' : ''}>加藤</option>
                        <option value="島田" ${data.handler === '島田' ? 'selected' : ''}>島田</option>
                    </select>
                </div>
            </div>

            <div class="section-divider">生徒情報</div>
            <div class="form-grid">
                <div class="form-group"><label>氏名</label><input type="text" name="name" id="field-name" value="${data.name || ''}" required></div>
                <div class="form-group"><label>フリガナ</label><input type="text" name="kana" id="field-kana" value="${data.kana || ''}" required></div>
                <div class="form-group"><label>性別</label>
                    <select name="gender" id="field-gender" required>
                        <option value="">選択</option>
                        <option value="boy" ${data.gender === 'boy' ? 'selected' : ''}>男子</option>
                        <option value="girl" ${data.gender === 'girl' ? 'selected' : ''}>女子</option>
                    </select>
                </div>
                <div class="form-group"><label>コース</label>
                    <div class="checkbox-group">
                        <label class="checkbox-label"><input type="checkbox" name="course_chiiku" ${data.courses?.includes('知育') || data.classCategory === '知育' ? 'checked' : ''}> 知育</label>
                        <label class="checkbox-label"><input type="checkbox" name="course_hallo" ${data.courses?.includes('HALLO') || data.classCategory === 'HALLO' ? 'checked' : ''}> HALLO</label>
                        <label class="checkbox-label"><input type="checkbox" name="course_juken" ${data.courses?.includes('受験') || data.classCategory === '受験' ? 'checked' : ''}> 受験</label>
                        <label class="checkbox-label"><input type="checkbox" name="course_astrum" ${data.courses?.includes('アストルム') || data.classCategory === 'アストルム' ? 'checked' : ''}> アストルム</label>
                        <label class="checkbox-label"><input type="checkbox" name="course_iq" ${data.courses?.includes('IQテスト') ? 'checked' : ''}> IQテスト</label>
                    </div>
                </div>
                <div class="form-group"><label>生年月日</label><input type="date" name="birthday" id="field-birthday" value="${data.birthday || ''}" required></div>
                <div class="form-group"><label>在籍園</label><input type="text" name="school" id="field-school" value="${data.school || ''}"></div>
            </div>

            <div class="section-divider">保護者情報</div>
            <div class="form-grid">
                <div class="form-group"><label>保護者氏名</label><input type="text" name="parentName" id="field-parentName" value="${data.parentName || ''}" required></div>
                <div class="form-group"><label>勤務先</label><input type="text" name="parentWork" value="${data.parentWork || ''}"></div>
                <div class="form-group"><label>電話番号</label><input type="tel" name="phone" id="field-phone" value="${data.phone || ''}"></div>
                <div class="form-group"><label>Email</label><input type="email" name="email" id="field-email" value="${data.email || ''}"></div>
                <div class="form-group" style="grid-column:1/-1;"><label>住所</label><input type="text" name="address" id="field-address" value="${data.address || ''}"></div>
            </div>

            <div class="section-divider">ヒアリング情報</div>
            <div class="form-grid" style="background-color: #fffbeb; padding: 1rem; border-radius: 0.5rem; border: 1px solid #fef3c7;">
                <div class="form-group"><label>性格</label><input type="text" name="personality" value="${data.personality || ''}"></div>
                <div class="form-group"><label>習い事</label><input type="text" name="lessons" value="${data.lessons || ''}"></div>
                <div class="form-group"><label>兄弟</label><input type="text" name="siblings" value="${data.siblings || ''}"></div>
                <div class="form-group"><label>タグ (カンマ区切り)</label><input type="text" name="tags" placeholder="例: 紹介, 兄弟あり, サマー2025" value="${(data.tags || []).join(', ')}"></div>
                <div class="form-group" style="grid-column:1/-1;"><label>問い合わせ経緯・CEに期待すること</label><textarea name="inquiryReason" rows="2">${data.inquiryReason || ''}</textarea></div>
                <div class="form-group" style="grid-column:1/-1;"><label>不安・懸念</label><textarea name="concerns" rows="2">${data.concerns || ''}</textarea></div>
                <div class="form-group"><label>通うとしたら希望曜日・時間</label><input type="text" name="preferredSchedule" value="${data.preferredSchedule || ''}"></div>
                <div class="form-group"><label>来校時ご主人（奥様）も同伴可能か</label><input type="text" name="partnerAttendance" value="${data.partnerAttendance || ''}"></div>
            </div>



            <div class="section-divider">詳細</div>
            <div class="form-grid">
                <div class="form-group" style="grid-column:1/-1; background-color: #fffbeb; padding: 1rem; border-radius: 0.5rem; border: 1px solid #fef3c7;"><label>メモ・ヒアリング</label><textarea name="memo" id="field-memo" rows="3" style="background:#fff;">${data.memo || ''}</textarea></div>
                
                <div class="form-group"><label>ステータス</label>
                    <select name="status" id="field-status">
                         <option value="inquiry_received" ${data.status === 'inquiry_received' ? 'selected' : ''}>問い合わせあり</option>
                        <option value="considering_incoming" ${data.status === 'considering_incoming' ? 'selected' : ''}>検討中（入電待）</option>
                        <option value="considering_outgoing" ${data.status === 'considering_outgoing' ? 'selected' : ''}>検討中（架電待）</option>
                        <option value="considering_longterm" ${data.status === 'considering_longterm' ? 'selected' : ''}>長期検討</option>
                        <option value="trial_booked" ${data.status === 'trial_booked' ? 'selected' : ''}>体験予約済み</option>
                        <option value="joined" ${data.status === 'joined' ? 'selected' : ''}>入会済み</option>
                        <option value="suspended" ${data.status === 'suspended' ? 'selected' : ''}>休会中</option>
                        <option value="declined" ${data.status === 'declined' ? 'selected' : ''}>不承認</option>
                        <option value="unresponsive" ${data.status === 'unresponsive' ? 'selected' : ''}>音信不通</option>
                        <option value="withdrawn" ${data.status === 'withdrawn' ? 'selected' : ''}>退会</option>
                    </select>
                </div>
                 <div class="form-group"><label>体験日時</label><input type="datetime-local" name="trialDate" id="field-trialDate" value="${data.trialDate || ''}"></div>
                 
                 <div class="form-group"><label>担当インストラクター</label>
                    <select name="instructor">
                        <option value="">選択</option>
                        ${['江塚', '鈴木', '川井', '清水', '敦子', '落合', '平井', '末永', '加藤', '島田'].map(n => `<option value="${n}" ${data.instructor === n ? 'selected' : ''}>${n}</option>`).join('')}
                    </select>
                 </div>
                 <div class="form-group"><label>入会面談者</label>
                    <select name="interviewer">
                        <option value="">選択</option>
                        ${['平井', '末永', '加藤', '島田'].map(n => `<option value="${n}" ${data.interviewer === n ? 'selected' : ''}>${n}</option>`).join('')}
                    </select>
                 </div>

                 <div class="form-group"><label>入会日</label><input type="date" name="joinedDate" value="${data.joinedDate || ''}"></div>
                 <div class="form-group">
                    <label>退会日 <span id="withdrawal-msg" style="color:red; font-size:0.8rem; display:none;">※必須</span></label>
                    <input type="date" name="withdrawalDate" id="field-withdrawalDate" value="${data.withdrawalDate || ''}">
                    <p id="withdrawal-error-text" style="color:red; font-size:0.8rem; display:none; margin-top:0.25rem;">退会ステータスの場合は退会日を入力してください</p>
                 </div>
            </div>

            <div class="form-actions">
                <button type="button" class="btn-secondary" onclick="window.history.back()">キャンセル</button>
                <button type="button" class="btn-primary" style="background:#f59e0b;" onclick="window.saveAndCreateTrialEmail()">体験確定メール作成</button>
                <button type="submit" class="btn-primary">保存する</button>
            </div>
        </form>
    `;

    if (!isEdit) {
        document.getElementById('magic-paste').addEventListener('input', (e) => {
            parseInquiryEmail(e.target.value);
        });
    }

    // Handle Pending Status (Redirect form list)
    if (state.pendingStatus === 'withdrawn') {
        const statusField = document.getElementById('field-status');
        if (statusField) {
            statusField.value = 'withdrawn';
            // Trigger visual update logic below
        }
        state.pendingStatus = null; // clear
    }

    // Withdrawal Date Logic
    const statusSelect = document.getElementById('field-status');
    const withdrawalDateInput = document.getElementById('field-withdrawalDate');
    const withdrawalMsg = document.getElementById('withdrawal-msg');
    const withdrawalErr = document.getElementById('withdrawal-error-text');

    const updateWithdrawalRequirement = () => {
        if (statusSelect.value === 'withdrawn') {
            withdrawalMsg.style.display = 'inline';
            withdrawalDateInput.required = true;
            withdrawalErr.style.display = !withdrawalDateInput.value ? 'block' : 'none';
        } else {
            withdrawalMsg.style.display = 'none';
            withdrawalDateInput.required = false;
            withdrawalErr.style.display = 'none';
        }
    };

    statusSelect.addEventListener('change', updateWithdrawalRequirement);
    withdrawalDateInput.addEventListener('input', updateWithdrawalRequirement);
    // Init check
    updateWithdrawalRequirement();



    const handleFormSubmit = async (e, actionType = 'save') => {
        if (e) e.preventDefault();
        const form = document.getElementById('student-form');

        // Withdrawal Validation
        if (statusSelect.value === 'withdrawn' && !withdrawalDateInput.value) {
            withdrawalErr.style.display = 'block';
            alert('退会ステータスが選択されています。退会日を入力してください。');
            withdrawalDateInput.focus();
            return;
        }

        if (!form.checkValidity()) {
            const firstInvalid = form.querySelector(':invalid');
            if (firstInvalid) {
                firstInvalid.focus();
                firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
                setTimeout(() => {
                    firstInvalid.reportValidity();
                }, 100);
            }
            return;
        }

        const formData = new FormData(form);
        const courses = [];
        if (formData.get('course_chiiku')) courses.push('知育');
        if (formData.get('course_hallo')) courses.push('HALLO');
        if (formData.get('course_juken')) courses.push('受験');
        if (formData.get('course_astrum')) courses.push('アストルム');
        if (formData.get('course_iq')) courses.push('IQテスト');

        if (courses.length === 0) {
            alert('コースを少なくとも1つ選択してください。');
            return;
        }

        const submitData = Object.fromEntries(formData.entries());



        // Tags processing
        const tagsRaw = submitData.tags || '';
        submitData.tags = tagsRaw.split(',').map(t => t.trim()).filter(t => t);

        delete submitData.course_chiiku; delete submitData.course_hallo; delete submitData.course_juken; delete submitData.course_astrum; delete submitData.course_iq;
        submitData.courses = courses;
        submitData.classCategory = courses[0] || '';

        try {
            let studentId = id;
            if (isEdit) {
                await updateStudent(id, submitData);
            } else {
                studentId = await addStudent(submitData);
            }

            // Googleカレンダー登録連携 (連携: 体験日時が新たに入力・変更された場合のみ)
            const oldTrialDate = data.trialDate || '';
            const newTrialDate = submitData.trialDate || '';
            if (newTrialDate && newTrialDate !== oldTrialDate) {
                const calUrl = generateGoogleCalendarUrl(
                    `体験: ${submitData.name}様`,
                    newTrialDate,
                    `保護者: ${submitData.parentName}様\n電話: ${submitData.phone || '-'}\nコース: ${courses.join(', ')}\n担当: ${submitData.handler || '-'}\n\n【ヒアリング情報】\n性格: ${submitData.personality || '-'}\n習い事: ${submitData.lessons || '-'}\n兄弟: ${submitData.siblings || '-'}\nタグ: ${(submitData.tags || []).join(', ') || '-'}\n経緯: ${submitData.inquiryReason || '-'}\n懸念: ${submitData.concerns || '-'}\n希望枠: ${submitData.preferredSchedule || '-'}\n同伴: ${submitData.partnerAttendance || '-'}\n\n【詳細メモ】\n${submitData.memo || '-'}`
                );
                window.open(calUrl, '_blank');
            }

            if (actionType === 'trial_email') {
                state.pendingEmailTemplate = 'trial_confirmation';
                window.location.hash = `#email/${studentId}`;
            } else {
                // Updated: Redirect to Dashboard after Edit
                if (isEdit) {
                    window.location.hash = '#dashboard';
                } else {
                    window.location.hash = '#students';
                }
            }
        } catch (e) {
            console.error("Save failed:", e);
            alert("保存に失敗しました。ネットワーク接続を確認してください。\nエラー: " + e.message);
        }
    };

    document.getElementById('student-form').addEventListener('submit', (e) => handleFormSubmit(e, 'save'));
    window.saveAndCreateTrialEmail = () => handleFormSubmit(null, 'trial_email');
}

// Reuse parseInquiryEmail (identical)
function parseInquiryEmail(text) {
    if (!text) return;

    const extract = (labels) => {
        for (const label of labels) {
            const safeLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(`${safeLabel}[\\t ]*[:：]?[\\t ]*((?:\\r?\\n[\\t ]*[^\\r\\n]+)|(?:[^\\r\\n]+))`, 'i');
            const match = text.match(regex);
            if (match) return match[1].trim();
        }
        return null;
    };

    const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el && val) el.value = val;
    };

    // 1. Parent Name
    const pName = extract(['保護者様のお名前（漢字）', '■保護者のお名前', '■問合せ者名', '保護者様のお名前', '保護者氏名', '氏名']);
    if (pName) setVal('field-parentName', pName);

    // 2. Child Name
    const cName = extract(['お子さまのお名前（漢字）', '■お子さまのお名前', '■お子様名', 'お子さまのお名前', '生徒氏名']);
    if (cName) setVal('field-name', cName);

    // 3. Child Kana
    const cKana = extract(['お子さまのお名前（カナ）', '■お子さまのお名前(フリガナ)', 'フリガナ', 'カナ']);
    if (cKana) setVal('field-kana', cKana);

    // 4. Email
    const email = extract(['■メールアドレス', 'メールアドレス', 'Email', 'email']);
    if (email) setVal('field-email', email);

    // 5. Phone
    const phone = extract(['■電話番号(半角数字)', '電話番号(半角数字)', '■電話番号', '電話番号', 'Tel', 'tel']);
    if (phone) setVal('field-phone', phone);

    // 6. Birthday
    const bdayRaw = extract(['お子さまの生年月日', '■お子さまの生年月日', '■生年月日', '生年月日']);
    if (bdayRaw) {
        const m = bdayRaw.match(/(\d{4})[\/\-年](\d{1,2})[\/\-月](\d{1,2})/);
        if (m) {
            setVal('field-birthday', `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`);
        }
    }

    // 7. Gender
    const genderRaw = extract(['お子さまの性別', '■お子さまの性別', '性別']);
    if (genderRaw) {
        if (/男|boy/i.test(genderRaw)) setVal('field-gender', 'boy');
        else if (/女|girl/i.test(genderRaw)) setVal('field-gender', 'girl');
    }

    // 8. Inquiry Date
    const iDateRaw = extract(['■問合せ日時', '日時', '送信日時']);
    if (iDateRaw) {
        const m = iDateRaw.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
        if (m) setVal('field-inquiryDate', `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`);
    }

    // 9. Memo / Extras
    let extras = [];
    const memo = extract(['ご要望', '■その他 ご質問・ご要望', '■お問い合わせ内容', 'お問い合わせ内容']);
    if (memo) extras.push(memo);

    // Additional case fields to memo
    const ageGrade = extract(['お子さまの年齢・学年', '■お子さまの年齢・学年']);
    if (ageGrade) extras.push(`[年齢・学年] ${ageGrade}`);

    const preferred = extract(['ご希望の教室をお選びください', '■教室名']);
    if (preferred && !preferred.includes('本郷三丁目')) extras.push(`[希望教室] ${preferred}`);

    const postal = extract(['■郵便番号', '郵便番号']);

    if (extras.length > 0) {
        const el = document.getElementById('field-memo');
        const current = el.value || '';
        // Avoid duplication if re-pasting
        const newExtras = extras.filter(ex => !current.includes(ex));

        if (newExtras.length > 0) {
            el.value = (current ? current + '\n\n' : '') + newExtras.join('\n');
        }
    }

    // Address
    const address = extract(['住所', 'ご住所']);
    const fullAddress = [postal ? `〒${postal}` : '', address].filter(Boolean).join(' ');
    if (fullAddress) {
        const el = document.getElementById('field-address');
        if (el && !el.value) el.value = fullAddress;
    }
}



async function renderAnalytics(year = null) {
    pageTitle.textContent = '問い合わせ・入会・生徒数分析';

    // Set/Get target year
    if (year) state.analyticsYear = parseInt(year);
    if (!state.analyticsYear) state.analyticsYear = 2026; // Default to 2026 per request
    const targetYear = state.analyticsYear;

    // Generate Jan-Dec for the target year
    const months = [];
    for (let m = 0; m < 12; m++) {
        const d = new Date(targetYear, m, 1);
        months.push({
            sub: `${targetYear}-${String(m + 1).padStart(2, '0')}`,
            label: `${m + 1}月`,
            date: d,
            inquiries: 0,
            contracts: 0, // Inquiries in this month that eventually joined (CV logic)
            newJoiners: 0, // Actual join date in this month
            withdrawals: 0,
            totalActive: 0
        });
    }

    // Fetch all students from Firestore
    // Note: In a real app with large data, we might want to query by date range.
    // For now, we fetch all and filter in memory as per previous logic.
    const studentsCollection = collection(db, 'students');
    const studentsSnapshot = await getDocs(studentsCollection);
    const allStudents = studentsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    const currentJoinedCount = allStudents.filter(s => ['joined', 'suspended'].includes(s.status)).length;

    // --- Calculate Monthly Stats ---
    months.forEach(m => {
        const mStart = new Date(m.date.getFullYear(), m.date.getMonth(), 1);
        const mEnd = new Date(m.date.getFullYear(), m.date.getMonth() + 1, 0, 23, 59, 59);

        // Flow Stats (Inquiries, Contracts(CV), Withdrawals)
        allStudents.forEach(s => {
            // Inquiries count
            if (s.inquiryDate) {
                const iDate = new Date(s.inquiryDate);
                if (iDate >= mStart && iDate <= mEnd) {
                    m.inquiries++;
                }
            }

            // Contracts (Actual join date in this month)
            if (['joined', 'suspended'].includes(s.status) && s.joinedDate) {
                const jDate = new Date(s.joinedDate);
                if (jDate >= mStart && jDate <= mEnd) {
                    m.contracts++;
                }
            }

            // Withdrawals (Flow)
            if (s.withdrawalDate) {
                const wDate = new Date(s.withdrawalDate);
                if (wDate >= mStart && wDate <= mEnd) {
                    m.withdrawals++;
                }
            } else if (s.status === 'withdrawn' && s.updatedAt) {
                const wDate = new Date(s.updatedAt);
                if (wDate >= mStart && wDate <= mEnd) {
                    m.withdrawals++;
                }
            }
        });

        // Stock Stats (Active at End of Month)
        // Logic: Joined <= MonthEnd AND (Not Withdrawn OR Withdrawn > MonthEnd)
        m.totalActive = allStudents.filter(s => {
            // Must be formally joined (or was joined) to be counted
            if (!['joined', 'suspended', 'withdrawn'].includes(s.status)) return false;

            if (!s.joinedDate) return false;
            const jDate = new Date(s.joinedDate);
            if (jDate > mEnd) return false; // Joined after this month

            if (s.withdrawalDate) {
                const wDate = new Date(s.withdrawalDate);
                if (wDate <= mEnd) return false; // Withdrawn before/during this month
            } else if (s.status === 'withdrawn') {
                // Fallback if no date
                const wDate = s.updatedAt ? new Date(s.updatedAt) : new Date();
                if (wDate <= mEnd) return false;
            }
            return true;
        }).length;
    });

    const maxVal = Math.max(30, ...months.map(m => Math.max(m.inquiries, m.contracts, m.totalActive)));
    const totalInquiriesYear = months.reduce((a, b) => a + b.inquiries, 0);

    // --- Calculate Course Breakdown Stats ---
    const joinedStudents = allStudents.filter(s => ['joined', 'suspended'].includes(s.status));
    // const totalJoined = joinedStudents.length; // Already defined as currentJoinedCount

    const breakdown = {
        chiiku: {},
        juken: 0,
        hallo: 0,
        astrum: 0
    };

    // Sort order for Chiiku classes
    const chiikuOrder = ['Sクラス', 'Cクラス', 'Qクラス', 'Tクラス', 'Dクラス', 'PDクラス'];

    joinedStudents.forEach(s => {
        const courses = s.courses || (s.classCategory ? [s.classCategory] : []);

        if (courses.includes('HALLO')) breakdown.hallo++;
        if (courses.includes('受験')) breakdown.juken++;
        if (courses.includes('アストルム')) breakdown.astrum++;

        if (courses.includes('知育')) {
            const cls = calculateClass(s.birthday);
            const rawName = cls.name.split(' ')[0]; // e.g. "Dクラス"
            if (!breakdown.chiiku[rawName]) breakdown.chiiku[rawName] = 0;
            breakdown.chiiku[rawName]++;
        }
    });

    // Helper to calc percentage
    const calcPct = (num) => currentJoinedCount > 0 ? ((num / currentJoinedCount) * 100).toFixed(1) + '%' : '0%';

    // --- Calculate Revenue Breakdown ---
    const coursePrices = {
        'PDクラス': 13860,
        'Dクラス': 13860,
        'Tクラス': 13860,
        'Qクラス': 17325,
        'Cクラス': 17325,
        'Sクラス': 17325,
        '受験': 27720,
        'HALLO': 15000,
        'アストルム': 0 // 金額が設定されていない場合は0
    };

    const revenueBreakdown = {
        chiiku: {},
        juken: breakdown.juken * coursePrices['受験'],
        hallo: breakdown.hallo * coursePrices['HALLO'],
        astrum: breakdown.astrum * coursePrices['アストルム'],
        total: 0
    };

    Object.keys(breakdown.chiiku).forEach(cls => {
        const count = breakdown.chiiku[cls];
        const price = coursePrices[cls] || 0;
        revenueBreakdown.chiiku[cls] = count * price;
        revenueBreakdown.total += count * price;
    });

    revenueBreakdown.total += revenueBreakdown.juken + revenueBreakdown.hallo + revenueBreakdown.astrum;
    const formatCurrency = (amount) => '¥' + amount.toLocaleString();

    contentArea.innerHTML = `
        <div style="display:flex; justify-content:flex-end; margin-bottom:1rem;">
            <select onchange="renderAnalytics(this.value)" style="padding:0.5rem; font-size:1rem; border-radius:0.5rem; border:1px solid var(--border);">
                <option value="2024" ${targetYear === 2024 ? 'selected' : ''}>2024年</option>
                <option value="2025" ${targetYear === 2025 ? 'selected' : ''}>2025年</option>
                <option value="2026" ${targetYear === 2026 ? 'selected' : ''}>2026年</option>
            </select>
        </div>

        <div style="display: grid; grid-template-columns: 300px 1fr; gap: 1.5rem; margin-bottom: 2rem;">
            <!-- Left Column: Totals -->
            <div style="display: flex; flex-direction: column; gap: 1.5rem;">
                <div class="stat-card" style="border-left: 4px solid var(--status-joined-text); flex: 1; display: flex; align-items: center; justify-content: space-between;">
                    <div class="stat-info">
                        <h3>現在の在籍生徒数</h3>
                        <div class="number">${currentJoinedCount}名</div>
                        <div style="font-size:0.8rem; color:var(--text-muted); margin-top:0.5rem;">※重複受講を含む延べ人数ではありません</div>
                    </div>
                     <div class="stat-icon" style="background:var(--status-joined-bg); color:var(--status-joined-text); position:static; transform:none; margin-left:1rem;">
                        <i class="ri-team-line"></i>
                    </div>
                </div>

                <div class="stat-card" style="flex: 1; display: flex; align-items: center; justify-content: space-between;">
                    <div class="stat-info">
                        <h3>年間問合せ数 (${targetYear}年)</h3>
                        <div class="number">${totalInquiriesYear}名</div>
                    </div>
                     <div class="stat-icon" style="background:#e2e8f0; color:#64748b; position:static; transform:none; margin-left:1rem;">
                        <i class="ri-mail-line"></i>
                    </div>
                </div>
            </div>

            <!-- Right Column: Breakdown -->
            <div class="stat-card" style="height: 100%; padding:0; overflow:hidden; display:flex; flex-direction:column;">
                <div style="padding: 1.25rem 2rem; background: #f8fafc; border-bottom: 1px solid #e2e8f0;">
                    <h3 style="margin:0; font-size:1.1rem; color:var(--text-color); font-weight:bold;">コース別内訳・売上 <span style="font-size:0.9rem; font-weight:normal; color:var(--text-muted); margin-left:0.5rem;">(対在籍生徒数比)</span></h3>
                </div>
                
                <div style="padding: 2rem; flex:1; display:flex; gap:2rem;">
                    
                    <!-- Chiiku Block -->
                    <div style="flex:1;">
                        <div style="display:flex; align-items:center; gap:0.5rem; margin-bottom:1.2rem; padding-bottom:0.6rem; border-bottom:2px solid var(--primary);">
                            <i class="ri-book-open-line" style="color:var(--primary); font-size:1.2rem;"></i>
                            <h4 style="margin:0; font-size:1.1rem; font-weight:bold; color:var(--text-color);">知育コース</h4>
                        </div>
                        <div style="display:grid; grid-template-columns: 1fr auto auto; gap:1rem; font-size:1rem; align-items:center;">
                            ${chiikuOrder.map(clsName => {
        const count = breakdown.chiiku[clsName] || 0;
        return count > 0 ? `
                                    <div style="display:flex; align-items:center; gap:0.6rem;">
                                        <div style="width:8px; height:8px; background:var(--primary); border-radius:50%;"></div>
                                        ${clsName}
                                    </div>
                                    <div style="font-weight:bold; font-size:1.1rem;">${count}</div>
                                    <div style="color:var(--text-muted); font-size:0.9rem; width:50px; text-align:right;">${calcPct(count)}</div>
                                ` : '';
    }).join('')}
                             ${Object.keys(breakdown.chiiku).filter(k => !chiikuOrder.includes(k)).map(k => {
        const count = breakdown.chiiku[k];
        return `
                                    <div style="display:flex; align-items:center; gap:0.6rem;">
                                        <div style="width:8px; height:8px; background:var(--primary); border-radius:50%;"></div>
                                        ${k}
                                    </div>
                                    <div style="font-weight:bold; font-size:1.1rem;">${count}</div>
                                    <div style="color:var(--text-muted); font-size:0.9rem; width:50px; text-align:right;">${calcPct(count)}</div>
                                 `;
    }).join('')}
                        </div>
                    </div>

                    <!-- Divider -->
                    <div style="width:1px; background:#e2e8f0;"></div>

                    <!-- Other Block -->
                    <div style="flex:1;">
                        <div style="display:flex; align-items:center; gap:0.5rem; margin-bottom:1.2rem; padding-bottom:0.6rem; border-bottom:2px solid #ea580c;">
                            <i class="ri-apps-line" style="color:#ea580c; font-size:1.2rem;"></i>
                            <h4 style="margin:0; font-size:1.1rem; font-weight:bold; color:var(--text-color);">その他コース</h4>
                        </div>
                        <div style="display:grid; grid-template-columns: 1fr auto auto; gap:1rem; font-size:1rem; align-items:center;">
                            <div style="display:flex; align-items:center; gap:0.6rem;">
                                <div style="width:8px; height:8px; background:#ef4444; border-radius:50%;"></div>受験
                            </div>
                            <div style="font-weight:bold; font-size:1.1rem;">${breakdown.juken}</div>
                            <div style="color:var(--text-muted); font-size:0.9rem; width:50px; text-align:right;">${calcPct(breakdown.juken)}</div>

                            <div style="display:flex; align-items:center; gap:0.6rem;">
                                <div style="width:8px; height:8px; background:#3b82f6; border-radius:50%;"></div>HALLO
                            </div>
                            <div style="font-weight:bold; font-size:1.1rem;">${breakdown.hallo}</div>
                            <div style="color:var(--text-muted); font-size:0.9rem; width:50px; text-align:right;">${calcPct(breakdown.hallo)}</div>

                            <div style="display:flex; align-items:center; gap:0.6rem;">
                                <div style="width:8px; height:8px; background:#a855f7; border-radius:50%;"></div>アストルム
                            </div>
                            <div style="font-weight:bold; font-size:1.1rem;">${breakdown.astrum}</div>
                            <div style="color:var(--text-muted); font-size:0.9rem; width:50px; text-align:right;">${calcPct(breakdown.astrum)}</div>
                        </div>
                    </div>

                    <!-- Divider -->
                    <div style="width:1px; background:#e2e8f0;"></div>

                    <!-- Revenue Block -->
                    <div style="flex:1;">
                        <div style="display:flex; align-items:center; gap:0.5rem; margin-bottom:1.2rem; padding-bottom:0.6rem; border-bottom:2px solid #10b981;">
                            <i class="ri-money-dollar-circle-line" style="color:#10b981; font-size:1.2rem;"></i>
                            <h4 style="margin:0; font-size:1.1rem; font-weight:bold; color:var(--text-color);">売上推計額</h4>
                        </div>
                        <div style="display:grid; grid-template-columns: 1fr auto; gap:0.8rem; font-size:1rem; align-items:center;">
                            ${chiikuOrder.map(clsName => {
                                const rev = revenueBreakdown.chiiku[clsName] || 0;
                                return rev > 0 ? `
                                    <div style="color:var(--text-color);">${clsName}</div>
                                    <div style="font-weight:bold; text-align:right;">${formatCurrency(rev)}</div>
                                ` : '';
                            }).join('')}
                            
                            ${Object.keys(revenueBreakdown.chiiku).filter(k => !chiikuOrder.includes(k) && revenueBreakdown.chiiku[k] > 0).map(k => `
                                <div style="color:var(--text-color);">${k}</div>
                                <div style="font-weight:bold; text-align:right;">${formatCurrency(revenueBreakdown.chiiku[k])}</div>
                            `).join('')}
                            
                            ${revenueBreakdown.juken > 0 ? `
                                <div style="color:var(--text-color);">受験</div>
                                <div style="font-weight:bold; text-align:right;">${formatCurrency(revenueBreakdown.juken)}</div>
                            ` : ''}
                            
                            ${revenueBreakdown.hallo > 0 ? `
                                <div style="color:var(--text-color);">HALLO</div>
                                <div style="font-weight:bold; text-align:right;">${formatCurrency(revenueBreakdown.hallo)}</div>
                            ` : ''}

                            ${revenueBreakdown.astrum > 0 ? `
                                <div style="color:var(--text-color);">アストルム</div>
                                <div style="font-weight:bold; text-align:right;">${formatCurrency(revenueBreakdown.astrum)}</div>
                            ` : ''}
                            
                            <div style="grid-column: 1 / -1; height: 1px; background: #e2e8f0; margin: 0.5rem 0;"></div>
                            
                            <div style="font-weight:bold; color:var(--text-color);">推計売上合計</div>
                            <div style="font-weight:bold; color:#10b981; font-size:1.2rem; text-align:right;">${formatCurrency(revenueBreakdown.total)}</div>
                        </div>
                    </div>

                </div>
            </div>
        </div>

        <div class="stats-grid" style="grid-template-columns: 1fr;">
            <div class="stat-card" style="display:block; padding-bottom: 2rem;">
                <h3 style="margin-bottom: 2rem;">${targetYear}年 月別 入会・退会・問合せ推移</h3>
                
                <div style="display:flex; justify-content:center; gap:1.5rem; margin-bottom:2rem; font-size:0.85rem; flex-wrap:wrap;">
                    <div style="display:flex; align-items:center; gap:0.4rem;"><div style="width:12px; height:12px; background:#94a3b8;"></div>問合せ</div>
                    <div style="display:flex; align-items:center; gap:0.4rem;"><div style="width:12px; height:12px; background:var(--primary);"></div>成約</div>
                    <div style="display:flex; align-items:center; gap:0.4rem;"><div style="width:12px; height:12px; background:var(--status-joined-text);"></div>生徒数(累積)</div>
                    <div style="display:flex; align-items:center; gap:0.4rem;"><div style="width:12px; height:12px; background:var(--status-lost-text);"></div>退会</div>
                </div>

                <div style="display: flex; height: 320px; margin-bottom: 1rem;">
                    <div style="display: flex; flex-direction: column; justify-content: space-between; padding-top: 40px; padding-bottom:0px; padding-right: 10px; color: var(--text-muted); font-size: 0.75rem; text-align: right; height: 100%;">
                        <div>${Math.ceil(maxVal)}</div>
                        <div>${Math.ceil(maxVal * 0.66)}</div>
                        <div>${Math.ceil(maxVal * 0.33)}</div>
                        <div>0</div>
                    </div>

                    <div style="position: relative; flex: 1; border-left: 1px solid #e2e8f0; border-bottom: 2px solid #e2e8f0; padding-top: 40px;">
                        <div style="position: absolute; top:0; left:0; width:100%; height:100%; display:flex; flex-direction:column; justify-content:space-between; z-index:0; pointer-events:none; padding-bottom: 2px;">
                             <div style="border-top:1px dashed #e2e8f0; width:100%; height:0;"></div>
                             <div style="border-top:1px dashed #e2e8f0; width:100%; height:0;"></div>
                             <div style="border-top:1px dashed #e2e8f0; width:100%; height:0;"></div>
                             <div style="border-top:0px dashed #e2e8f0; width:100%; height:0;"></div>
                        </div>

                        <div style="display: flex; height: 100%; align-items: flex-end; justify-content: space-around; padding: 0 10px; position:relative; z-index:1;">
                        ${months.map(m => `
                            <div style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; position: relative;">
                                <div style="display: flex; align-items: flex-end; gap: 3px; height: 100%; padding-bottom: 0px;">
                                    <div style="width: 6px; height: ${(m.inquiries / maxVal) * 100}%; background: #94a3b8; border-radius: 2px 2px 0 0;" title="問合せ: ${m.inquiries}"></div>
                                    <div style="width: 6px; height: ${(m.contracts / maxVal) * 100}%; background: var(--primary); border-radius: 2px 2px 0 0;" title="成約: ${m.contracts}"></div>
                                    <div style="width: 6px; height: ${(m.totalActive / maxVal) * 100}%; background: var(--status-joined-text); border-radius: 2px 2px 0 0;" title="生徒数: ${m.totalActive}"></div>
                                    <div style="width: 6px; height: ${(m.withdrawals / maxVal) * 100}%; background: var(--status-lost-text); border-radius: 2px 2px 0 0;" title="退会: ${m.withdrawals}"></div>
                                </div>
                                <div style="position: absolute; bottom: -30px; font-size: 0.8rem; font-weight: 500; color: var(--text-color); width: 100%; text-align: center;">${m.label.replace('月', '')}</div>
                            </div>
                        `).join('')}
                        </div>
                    </div>
                </div>

                <div style="height: 30px;"></div>

                <div style="margin-top: 2rem;">
                    <table style="width: 100%; border-collapse: collapse; font-size: 0.9rem;">
                        <thead>
                            <tr style="background: #f8fafc; border-bottom: 2px solid var(--border);">
                                <th style="padding: 0.75rem;">年月</th>
                                <th style="padding: 0.75rem;">問合せ</th>
                                <th style="padding: 0.75rem; color: var(--primary);">成約</th>
                                <th style="padding: 0.75rem; color: var(--primary);">成約率(CV)</th>
                                <th style="padding: 0.75rem; color: var(--status-lost-text);">退会</th>
                                <th style="padding: 0.75rem; font-weight:bold; color: #64748b;">在籍数 (末日)</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${months.slice().reverse().map(m => {
        const cvRate = m.inquiries > 0 ? ((m.contracts / m.inquiries) * 100).toFixed(1) + '%' : '-';
        return `
                                <tr style="border-bottom: 1px solid var(--border);">
                                    <td style="padding: 0.75rem; font-weight: 500;">${m.sub}</td>
                                    <td style="padding: 0.75rem; text-align:center;">${m.inquiries}</td>
                                    <td style="padding: 0.75rem; text-align:center; font-weight:bold; color:var(--primary);">${m.contracts}</td>
                                    <td style="padding: 0.75rem; text-align:center; color:var(--primary);">${cvRate}</td>
                                    <td style="padding: 0.75rem; text-align:center;">${m.withdrawals > 0 ? '-' + m.withdrawals : '0'}</td>
                                    <td style="padding: 0.75rem; text-align:center; font-weight:bold; color: #64748b;">${m.totalActive}名</td>
                                </tr>
                            `}).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    `;

    // Global function for selector
    window.renderAnalytics = renderAnalytics;
}

function renderInstructorAnalytics() {
    pageTitle.textContent = 'インストラクター分析';

    const allStudents = state.students;

    // --- Calculate Instructor Stats ---
    const activeStudents = allStudents.filter(s => s.status === 'joined');
    const uniqueClasses = new Map();

    activeStudents.forEach(s => {
        if (s.schedule && Array.isArray(s.schedule)) {
            s.schedule.forEach(sch => {
                if (!sch.day || !sch.startTime || !sch.endTime || !sch.teacher) return;
                const key = `${sch.day}_${sch.room || 'Room1'}_${sch.startTime}_${sch.endTime}_${sch.course || '知育'}_${sch.teacher}`;
                if (!uniqueClasses.has(key)) {
                    uniqueClasses.set(key, {
                        day: sch.day,
                        room: sch.room || '-',
                        startTime: sch.startTime,
                        endTime: sch.endTime,
                        course: sch.course || '未定',
                        teacher: sch.teacher,
                        students: []
                    });
                }
                if (!uniqueClasses.get(key).students.includes(s.name)) {
                    uniqueClasses.get(key).students.push(s.name);
                }
            });
        }
    });

    const teacherStats = {};
    Object.keys(TEACHER_RATES).forEach(t => {
        teacherStats[t] = {
            classes: [],
            totalHours: 0,
            totalWage: 0,
            totalSlots: 0,
            courseCounts: {}
        };
    });

    uniqueClasses.forEach(cls => {
        const t = cls.teacher;
        if (!teacherStats[t]) {
            teacherStats[t] = {
                classes: [],
                totalHours: 0,
                totalWage: 0,
                totalSlots: 0,
                courseCounts: {}
            };
        }

        const [sh, sm] = cls.startTime.split(':').map(Number);
        const [eh, em] = cls.endTime.split(':').map(Number);
        const duration = (eh + em / 60) - (sh + sm / 60);

        const rate = getWageRate(t, cls.day, cls.course);
        const wage = duration * rate;

        // クラスのカテゴリ分け（PD, D, T, Q, C, Sなどを個別に保持）
        let category = cls.course || 'その他';
        if (cls.course.includes('受験')) {
            category = '受験';
        } else if (cls.course.includes('HALLO')) {
            category = 'HALLO';
        } else if (cls.course.includes('アストルム')) {
            category = 'アストルム';
        }

        teacherStats[t].courseCounts[category] = (teacherStats[t].courseCounts[category] || 0) + 1;

        teacherStats[t].classes.push({
            ...cls,
            duration,
            rate,
            wage
        });
        teacherStats[t].totalHours += duration;
        teacherStats[t].totalWage += wage;
        teacherStats[t].totalSlots += 1;
    });

    // --- Calculate Study Hours for Each Teacher ---
    const targetCourses = ['PD', 'D', 'T', 'Q', 'C', 'S', 'アストルム', 'HALLO', '受験'];
    
    Object.keys(teacherStats).forEach(t => {
        const stats = teacherStats[t];
        stats.studyHoursList = [];
        stats.weeklyStudyWage = 0;
        stats.totalStudyHours = 0;

        targetCourses.forEach(courseKey => {
            const matchingClasses = stats.classes.filter(c => {
                if (courseKey === 'D') {
                    return c.course.includes('D') && !c.course.includes('PD');
                }
                return c.course.includes(courseKey);
            });

            if (matchingClasses.length > 0) {
                stats.totalStudyHours += 0.5;

                const refClass = matchingClasses[0];
                const rate = getWageRate(t, refClass.day, refClass.course);
                const wage = 0.5 * rate;
                
                stats.weeklyStudyWage += wage;

                stats.studyHoursList.push({
                    course: courseKey,
                    hours: 0.5,
                    rate: rate,
                    wage: wage
                });
            }
        });

        // 勉強時間報酬を含んだ個人想定報酬合計
        stats.totalWeeklyWageIncludingStudy = stats.totalWage + stats.weeklyStudyWage;
        stats.totalMonthlyWageIncludingStudy = (stats.totalWage * 4) + (stats.weeklyStudyWage * 4);
    });

    // Calculate Totals for Summary
    let totalAllSlots = 0;
    let totalAllWeeklyWage = 0;
    Object.values(teacherStats).forEach(s => {
        totalAllSlots += s.totalSlots;
        totalAllWeeklyWage += s.totalWeeklyWageIncludingStudy; // 授業 + 勉強時間
    });

    contentArea.innerHTML = `
        <div class="stats-grid" style="grid-template-columns: 1fr;">
            <div class="stat-card" style="display:block; padding: 2rem;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1.5rem; border-bottom:2px solid var(--primary); padding-bottom:0.5rem;">
                    <h3 style="margin:0; font-size:1.2rem; color:var(--text-color); display:flex; align-items:center; gap:0.5rem;">
                        <i class="ri-user-settings-line" style="color:var(--primary);"></i>
                        インストラクター別 担当クラス・想定報酬（固定スケジュール）
                    </h3>
                    <span style="font-size:0.85rem; color:var(--text-muted);">※在籍中・休会中生徒の固定スケジュールから集計</span>
                </div>

                <!-- 講師全体サマリー -->
                <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap:1rem; margin-bottom:2rem;">
                    <div style="background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%); border: 1px solid #bfdbfe; padding:1rem; border-radius:0.75rem; display:flex; align-items:center; justify-content:space-between; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.05);">
                        <div>
                            <div style="font-size:0.85rem; color:#1e40af; font-weight:bold;">全体総コマ数</div>
                            <div style="font-size:1.8rem; font-weight:bold; color:#1d4ed8; margin-top:0.25rem;">${totalAllSlots} <span style="font-size:1rem; font-weight:normal;">コマ</span></div>
                        </div>
                        <i class="ri-calendar-todo-line" style="font-size:2.5rem; color:#3b82f6; opacity:0.3;"></i>
                    </div>
                    <div style="background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); border: 1px solid #bbf7d0; padding:1rem; border-radius:0.75rem; display:flex; align-items:center; justify-content:space-between; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.05);">
                        <div>
                            <div style="font-size:0.85rem; color:#166534; font-weight:bold;">週間想定報酬総額</div>
                            <div style="font-size:1.8rem; font-weight:bold; color:#15803d; margin-top:0.25rem;">¥${Math.round(totalAllWeeklyWage).toLocaleString()}</div>
                        </div>
                        <i class="ri-money-yen-box-line" style="font-size:2.5rem; color:#22c55e; opacity:0.3;"></i>
                    </div>
                    <div style="background: linear-gradient(135deg, #faf5ff 0%, #f3e8ff 100%); border: 1px solid #e9d5ff; padding:1rem; border-radius:0.75rem; display:flex; align-items:center; justify-content:space-between; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.05);">
                        <div>
                            <div style="font-size:0.85rem; color:#6b21a8; font-weight:bold;">月間想定報酬総額 (4週換算)</div>
                            <div style="font-size:1.8rem; font-weight:bold; color:#7e22ce; margin-top:0.25rem;">¥${Math.round(totalAllWeeklyWage * 4).toLocaleString()}</div>
                        </div>
                        <i class="ri-bank-card-line" style="font-size:2.5rem; color:#a855f7; opacity:0.3;"></i>
                    </div>
                </div>

                <!-- 講師別詳細リスト -->
                <div style="display:flex; flex-direction:column; gap:1.5rem;">
                    ${Object.entries(teacherStats).map(([teacherName, stats]) => {
                        const hasClasses = stats.classes.length > 0;
                        const isOwner = ['平井', '末永'].includes(teacherName);
                        
                        // 個別コース別コマ数集計
                        const pdCount = stats.classes.filter(c => c.course.includes('PD')).length;
                        const dCount = stats.classes.filter(c => c.course.includes('D') && !c.course.includes('PD')).length;
                        const tCount = stats.classes.filter(c => c.course.includes('T')).length;
                        const qCount = stats.classes.filter(c => c.course.includes('Q')).length;
                        const cCount = stats.classes.filter(c => c.course.includes('C')).length;
                        const sCount = stats.classes.filter(c => c.course.includes('S')).length;
                        const astrumCount = stats.classes.filter(c => c.course.includes('アストルム')).length;
                        const halloCount = stats.classes.filter(c => c.course.includes('HALLO')).length;
                        const examCount = stats.classes.filter(c => c.course.includes('受験')).length;

                        return `
                        <div style="border: 1px solid #e2e8f0; border-radius:0.75rem; overflow:hidden; background:#fff; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                            <!-- カードヘッダー -->
                            <div style="background:#f8fafc; padding:1rem 1.5rem; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #e2e8f0; flex-wrap:wrap; gap:1rem;">
                                <div style="display:flex; align-items:center; gap:0.75rem;">
                                    <span style="font-size:1.1rem; font-weight:bold; color:#1e293b; background:#e2e8f0; padding:0.25rem 0.75rem; border-radius:9999px;">
                                        ${teacherName}
                                    </span>
                                    <span style="font-size:0.9rem; color:#64748b;">
                                        担当クラス数: <b style="color:#1e3a8a; font-size:1.1rem;">${stats.totalSlots}</b> コマ (${stats.totalHours.toFixed(1)}時間)
                                    </span>
                                </div>
                                <div style="display:flex; gap:1.5rem; align-items:center;">
                                    <div style="text-align:right;">
                                        <span style="font-size:0.8rem; color:#64748b; display:block;">週間想定報酬</span>
                                        <span style="font-size:1.15rem; font-weight:bold; color:${isOwner ? '#64748b' : '#16a34a'};" title="内訳: 授業 ¥${Math.round(stats.totalWage).toLocaleString()} + 勉強手当 ¥${Math.round(stats.weeklyStudyWage).toLocaleString()}">
                                            ${isOwner ? '対象外' : `¥${Math.round(stats.totalWeeklyWageIncludingStudy).toLocaleString()}`}
                                        </span>
                                    </div>
                                    <div style="width:1px; height:24px; background:#cbd5e1;"></div>
                                    <div style="text-align:right;">
                                        <span style="font-size:0.8rem; color:#64748b; display:block;">月間想定報酬 (4週)</span>
                                        <span style="font-size:1.15rem; font-weight:bold; color:${isOwner ? '#64748b' : '#2563eb'};" title="内訳: 授業 ¥${Math.round(stats.totalWage * 4).toLocaleString()} + 勉強手当 ¥${Math.round(stats.weeklyStudyWage * 4).toLocaleString()}">
                                            ${isOwner ? '対象外' : `¥${Math.round(stats.totalMonthlyWageIncludingStudy).toLocaleString()}`}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            <!-- 担当クラス一覧 -->
                            <div style="padding:1rem; overflow-x:auto;">
                                ${hasClasses ? `
                                <!-- コース別担当コマ数内訳ミニテーブル＆勉強時間手当の横並びコンテナ -->
                                <div style="margin-bottom: 1.5rem; display: flex; gap: 1rem; flex-wrap: wrap; align-items: stretch;">
                                    
                                    <!-- コース別担当コマ数内訳ミニテーブル -->
                                    <div style="background: #f8fafc; padding: 0.75rem 1rem; border-radius: 0.5rem; border: 1px solid #e2e8f0; width: fit-content; display:flex; flex-direction:column; gap:0.4rem; justify-content:center;">
                                        <div style="font-size:0.8rem; font-weight:bold; color:#64748b; display:flex; align-items:center; gap:0.25rem;">
                                            <i class="ri-grid-line"></i> コース別担当コマ数
                                        </div>
                                        <div style="display: grid; grid-template-columns: repeat(9, minmax(65px, 1fr)); gap: 1px; background: #cbd5e1; border: 1px solid #cbd5e1; border-radius: 6px; overflow: hidden; text-align: center; font-size: 0.8rem; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                                            <!-- 上の段: 項目名 -->
                                            <div style="background: #f1f5f9; padding: 6px 4px; font-weight: bold; color: #475569;">PD</div>
                                            <div style="background: #f1f5f9; padding: 6px 4px; font-weight: bold; color: #475569;">D</div>
                                            <div style="background: #f1f5f9; padding: 6px 4px; font-weight: bold; color: #475569;">T</div>
                                            <div style="background: #f1f5f9; padding: 6px 4px; font-weight: bold; color: #475569;">Q</div>
                                            <div style="background: #f1f5f9; padding: 6px 4px; font-weight: bold; color: #475569;">C</div>
                                            <div style="background: #f1f5f9; padding: 6px 4px; font-weight: bold; color: #475569;">S</div>
                                            <div style="background: #f1f5f9; padding: 6px 4px; font-weight: bold; color: #475569; font-size:0.75rem;">アストルム</div>
                                            <div style="background: #f1f5f9; padding: 6px 4px; font-weight: bold; color: #475569;">HALLO</div>
                                            <div style="background: #f1f5f9; padding: 6px 4px; font-weight: bold; color: #475569;">受験</div>
                                            
                                            <!-- 下の段: コマ数 -->
                                            <div style="background: #fff; padding: 8px 4px; font-weight: bold; font-size: 1.05rem; color: ${pdCount > 0 ? '#1d4ed8' : '#94a3b8'};">${pdCount}</div>
                                            <div style="background: #fff; padding: 8px 4px; font-weight: bold; font-size: 1.05rem; color: ${dCount > 0 ? '#1d4ed8' : '#94a3b8'};">${dCount}</div>
                                            <div style="background: #fff; padding: 8px 4px; font-weight: bold; font-size: 1.05rem; color: ${tCount > 0 ? '#1d4ed8' : '#94a3b8'};">${tCount}</div>
                                            <div style="background: #fff; padding: 8px 4px; font-weight: bold; font-size: 1.05rem; color: ${qCount > 0 ? '#1d4ed8' : '#94a3b8'};">${qCount}</div>
                                            <div style="background: #fff; padding: 8px 4px; font-weight: bold; font-size: 1.05rem; color: ${cCount > 0 ? '#1d4ed8' : '#94a3b8'};">${cCount}</div>
                                            <div style="background: #fff; padding: 8px 4px; font-weight: bold; font-size: 1.05rem; color: ${sCount > 0 ? '#1d4ed8' : '#94a3b8'};">${sCount}</div>
                                            <div style="background: #fff; padding: 8px 4px; font-weight: bold; font-size: 1.05rem; color: ${astrumCount > 0 ? '#7c3aed' : '#94a3b8'};">${astrumCount}</div>
                                            <div style="background: #fff; padding: 8px 4px; font-weight: bold; font-size: 1.05rem; color: ${halloCount > 0 ? '#1d4ed8' : '#94a3b8'};">${halloCount}</div>
                                            <div style="background: #fff; padding: 8px 4px; font-weight: bold; font-size: 1.05rem; color: ${examCount > 0 ? '#dc2626' : '#94a3b8'};">${examCount}</div>
                                        </div>
                                    </div>

                                    <!-- 勉強時間手当の表示 -->
                                    <div style="background: #fffbeb; padding: 0.75rem 1rem; border-radius: 0.5rem; border: 1px solid #fef3c7; width: fit-content; display:flex; flex-direction:column; gap:0.4rem; justify-content:center; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                                        <div style="font-size:0.8rem; font-weight:bold; color:#b45309; display:flex; align-items:center; gap:0.25rem;">
                                            <i class="ri-book-open-line"></i> 勉強時間手当 (週30分/コース)
                                        </div>
                                        <div style="font-size:0.8rem; color:#78350f; font-weight:500;">
                                            対象: ${stats.studyHoursList.map(s => `<span style="background:#fef3c7; border: 1px solid #fde047; padding:1px 4px; border-radius:4px; margin-right:3px; font-size:0.75rem;">${s.course}</span>`).join('') || '<span style="color:#94a3b8;">対象なし</span>'}
                                        </div>
                                        <div style="font-size:0.8rem; color:#78350f;">
                                            週間勉強時間: <b style="font-size:0.95rem; color:#b45309;">${stats.totalStudyHours * 60}分</b> (週間手当: <b style="font-size:0.95rem; color:#b45309;">${isOwner ? '対象外' : `¥${Math.round(stats.weeklyStudyWage).toLocaleString()}`}</b>)
                                        </div>
                                        <div style="font-size:0.75rem; color:#92400e; border-top:1px dashed #fde047; padding-top:0.25rem; margin-top:0.1rem;">
                                            月換算 (4週): <b>${(stats.totalStudyHours * 60 * 4) / 60}時間 (${stats.totalStudyHours * 60 * 4}分)</b> (月間想定手当: <b>${isOwner ? '対象外' : `¥${Math.round(stats.weeklyStudyWage * 4).toLocaleString()}`}</b>)
                                        </div>
                                    </div>

                                </div>

                                <table style="width:100%; border-collapse:collapse; font-size:0.85rem; text-align:left;">
                                    <thead>
                                        <tr style="border-bottom:2px solid #e2e8f0; color:#475569; font-weight:bold; background:#f8fafc;">
                                            <th style="padding:0.75rem; border-radius:4px 0 0 0;">曜日</th>
                                            <th style="padding:0.75rem;">時間</th>
                                            <th style="padding:0.75rem;">コース</th>
                                            <th style="padding:0.75rem;">教室</th>
                                            <th style="padding:0.75rem;">生徒数</th>
                                            <th style="padding:0.75rem;">生徒名</th>
                                            <th style="padding:0.75rem; text-align:right; border-radius:0 4px 0 0;">想定報酬 (時間単価)</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${stats.classes.map(c => {
                                            const isExam = c.course.includes('受験');
                                            const isSat = c.day === '土';
                                            return `
                                            <tr style="border-bottom:1px solid #f1f5f9;">
                                                <td style="padding:0.75rem;"><span style="background:${isSat ? '#dbeafe' : '#fef3c7'}; color:${isSat ? '#1e40af' : '#d97706'}; font-weight:bold; padding:2px 6px; border-radius:4px;">${c.day}曜日</span></td>
                                                <td style="padding:0.75rem; font-weight:500;">${c.startTime}〜${c.endTime} (${c.duration.toFixed(1)}h)</td>
                                                <td style="padding:0.75rem;"><span style="font-weight:600; color:${isExam ? '#dc2626' : '#1e293b'};">${c.course}</span></td>
                                                <td style="padding:0.75rem; color:#475569;">${c.room}</td>
                                                <td style="padding:0.75rem; font-weight:bold; color:#2563eb;">${c.students.length}名</td>
                                                <td style="padding:0.75rem; color:#64748b; font-size:0.8rem; max-width:220px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${c.students.join(', ')}">${c.students.join(', ')}</td>
                                                <td style="padding:0.75rem; text-align:right; font-weight:600;">
                                                    ${isOwner ? '-' : `
                                                        ¥${Math.round(c.wage).toLocaleString()}
                                                        <span style="font-size:0.75rem; color:#64748b; font-weight:normal; margin-left:0.25rem;">(¥${c.rate}/h)</span>
                                                    `}
                                                </td>
                                            </tr>
                                            `;
                                        }).join('')}
                                    </tbody>
                                </table>
                                ` : `
                                <div style="padding:1.5rem; text-align:center; color:#94a3b8; font-size:0.9rem;">
                                    現在, 固定授業スケジュールの担当はありません。
                                </div>
                                `}
                            </div>
                        </div>
                        `;
                    }).join('')}
                </div>
            </div>
        </div>
    `;
}


function getSchoolInfo(schoolName) {
    if (!schoolName) return null;
    return state.schools.find(s => {
        if (schoolName.includes(s.name)) return true;
        if (s.keywords && s.keywords.some(k => schoolName.includes(k))) return true;
        return false;
    });
}

function generateGoogleCalendarUrl(title, date, details) {
    const d = new Date(date);
    if (isNaN(d.getTime())) return '#';
    const formatDateTime = (dateObj) => {
        const yyyy = dateObj.getFullYear();
        const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
        const dd = String(dateObj.getDate()).padStart(2, '0');
        const hh = String(dateObj.getHours()).padStart(2, '0');
        const min = String(dateObj.getMinutes()).padStart(2, '0');
        return `${yyyy}${mm}${dd}T${hh}${min}00`;
    };
    const startStr = formatDateTime(d);
    const endD = new Date(d.getTime() + 60 * 60 * 1000); // 1 hour
    const endStr = formatDateTime(endD);
    const params = new URLSearchParams({
        action: "TEMPLATE",
        text: title,
        dates: `${startStr}/${endStr}`,
        details: details
    });
    return `https://www.google.com/calendar/render?${params.toString()}`;
}


function renderEmailDraft(id) {
    const s = state.students.find(s => s.id === id);
    if (!s) return;
    pageTitle.textContent = 'メール作成';

    const defaultTemplate = state.pendingEmailTemplate ? EMAIL_TEMPLATES[state.pendingEmailTemplate] : EMAIL_TEMPLATES['default'];
    // Clear pending state
    state.pendingEmailTemplate = null;

    const subject = defaultTemplate.subject(s);
    const body = defaultTemplate.body(s);

    contentArea.innerHTML = `
        <div class="email-container" style="max-width: 800px; margin: 0 auto; background: #fff; padding: 2rem; border-radius: 1rem; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1);">
            <div style="margin-bottom: 1.5rem;">
                <label style="display:block; margin-bottom:0.5rem; font-weight:bold; color:var(--text-color);">送信先</label>
                <div style="padding:0.75rem; background:#f8fafc; border:1px solid var(--border); border-radius:0.5rem;">
                    ${s.email ? `To: ${s.email} (${s.parentName}様)` : '<span style="color:red;">※メールアドレスが登録されていません</span>'}
                </div>
            </div>

            <div style="margin-bottom: 1.5rem;">
                <label style="display:block; margin-bottom:0.5rem; font-weight:bold; color:var(--text-color);">件名</label>
                <input type="text" id="email-subject" value="${subject}" style="width:100%; padding:0.75rem; border:1px solid var(--border); border-radius:0.5rem; font-size:1rem;">
            </div>

            <div style="margin-bottom: 1.5rem;">
                <label style="display:block; margin-bottom:0.5rem; font-weight:bold; color:var(--text-color);">本文</label>
                <div style="margin-bottom:0.5rem; font-size:0.8rem; color:var(--text-muted);">
                    使用可能な変数: {保護者名}, {生徒名}, {ふりがな}, {コース}, {担当}, {ステータス}
                </div>
                <textarea id="email-body" rows="15" style="width:100%; padding:0.75rem; border:1px solid var(--border); border-radius:0.5rem; font-size:1rem; line-height:1.6; resize:vertical;">${body}</textarea>
            </div>

            <div style="display: flex; gap: 1rem; justify-content: space-between; align-items: center; border-top: 1px solid var(--border); padding-top: 1.5rem; flex-wrap:wrap;">
                <div style="display:flex; gap:0.5rem; align-items:center;">
                    <select id="template-select" onchange="applyTemplate('${s.id}', this.value)" style="padding:0.5rem; border-radius:0.5rem; border:1px solid var(--border); max-width:200px;">
                        <option value="">テンプレートを選択...</option>
                        <optgroup label="システム標準">
                            ${Object.keys(EMAIL_TEMPLATES).map(k => `<option value="${k}">${EMAIL_TEMPLATES[k].label}</option>`).join('')}
                        </optgroup>
                        ${state.customTemplates.length > 0 ? `<optgroup label="作成済みテンプレート">
                            ${state.customTemplates.map(t => `<option value="${t.id}">${t.label}</option>`).join('')}
                        </optgroup>` : ''}
                    </select>
                    <button class="btn-secondary" onclick="saveCurrentAsTemplate()" title="新規テンプレートとして保存" style="padding:0.5rem;"><i class="ri-save-line"></i> 保存</button>
                    <button class="btn-secondary" onclick="deleteSelectedTemplate()" title="選択中のテンプレートを削除" style="padding:0.5rem; color:#dc2626; border-color:#fca5a5;"><i class="ri-delete-bin-line"></i></button>
                </div>

                <div style="display:flex; gap:1rem;">
                    <button class="btn-secondary" onclick="window.history.back()">キャンセル</button>
                    <a href="${generateGmailLink(s.email, subject, body)}" target="_blank" id="mailto-btn" class="btn-primary" style="text-decoration:none; display:inline-flex; align-items:center; gap:0.5rem; background:#DB4437; border:none;">
                        <i class="ri-mail-send-line"></i> Gmailを起動
                    </a>
                </div>
            </div>
            <p style="text-align:right; font-size:0.8rem; color:var(--text-muted); margin-top:0.5rem;">
                ※「Gmailを起動」を押すと、Gmailの新規作成画面が開きます。<br>
                送信元が <b>contact@ce-hongo.com</b> になっているかご確認ください。
            </p>
        </div>
    `;

    // Real-time update for mailto link
    const updateMailto = () => {
        const sub = document.getElementById('email-subject').value;
        const bdy = document.getElementById('email-body').value;
        const btn = document.getElementById('mailto-btn');
        btn.href = generateGmailLink(s.email, sub, bdy);
    };
    document.getElementById('email-subject').addEventListener('input', updateMailto);
    document.getElementById('email-body').addEventListener('input', updateMailto);
}

// Variables for custom templates
const PLACEHOLDER_MAP = {
    '{保護者名}': (s) => s.parentName || '',
    '{生徒名}': (s) => s.name || '',
    '{ふりがな}': (s) => s.kana || '',
    '{コース}': (s) => (s.courses || []).join(', '),
    '{ステータス}': (s) => STATUS_DEFINITIONS.find(d => d.value === s.status)?.label || s.status,
    '{担当}': (s) => s.handler || '',
};

window.applyTemplate = function (id, templateKey) {
    const s = state.students.find(s => s.id === id);
    if (!s) return;

    let subject = '';
    let body = '';

    // Check System Templates
    if (EMAIL_TEMPLATES[templateKey]) {
        const t = EMAIL_TEMPLATES[templateKey];
        subject = t.subject(s);
        body = t.body(s);
    }
    // Check Custom Templates
    else {
        const custom = state.customTemplates.find(t => t.id === templateKey);
        if (custom) {
            subject = custom.subject;
            body = custom.body;
            // Substitute variables
            Object.keys(PLACEHOLDER_MAP).forEach(key => {
                const val = PLACEHOLDER_MAP[key](s);
                subject = subject.replaceAll(key, val);
                body = body.replaceAll(key, val);
            });
        }
    }

    if (subject || body) {
        document.getElementById('email-subject').value = subject;
        document.getElementById('email-body').value = body;
        // Trigger input event to update mailto link
        document.getElementById('email-subject').dispatchEvent(new Event('input'));
    }
};

window.saveCurrentAsTemplate = async function () {
    const name = prompt('テンプレート名を入力してください:\n（例: お問い合わせ返信2, 体験後フォロー）');
    if (!name) return;

    // Check Duplicate
    if (Object.keys(EMAIL_TEMPLATES).includes(name) || state.customTemplates.some(t => t.label === name)) {
        alert('そのテンプレート名はすでに存在します。別の名前を入力してください。');
        return;
    }

    const subject = document.getElementById('email-subject').value;
    const body = document.getElementById('email-body').value;

    try {
        await addDoc(collection(db, 'mail_templates'), {
            label: name,
            subject: subject,
            body: body,
            updatedAt: new Date().toISOString()
        });
        alert('テンプレートを保存しました。');
    } catch (e) {
        console.error(e);
        alert('保存に失敗しました: ' + e.message);
    }
};

window.deleteSelectedTemplate = async function () {
    const select = document.getElementById('template-select');
    const templateId = select.value;

    if (!templateId) return;

    // Check if system template
    if (EMAIL_TEMPLATES[templateId]) {
        alert('システム標準のテンプレートは削除できません。');
        return;
    }

    if (confirm('このテンプレートを削除しますか？\n（元に戻せません）')) {
        try {
            await deleteDoc(doc(db, 'mail_templates', templateId));
            alert('削除しました。');
            select.value = "";
        } catch (e) {
            console.error(e);
            alert('削除に失敗しました: ' + e.message);
        }
    }
};

function generateGmailLink(email, subject, body) {
    return `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(email)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function renderDetail(id, focusTarget = null, isReadOnly = false) {
    try {
        console.log('renderDetail called with ID:', id);
        const s = state.students.find(s => s.id === id);
        if (!s) {
            contentArea.innerHTML = '<div style="padding:2rem; text-align:center; color:#64748b;">データ読み込み中、または生徒が見つかりません... (ID: ' + id + ')</div>';
            return;
        }
        pageTitle.textContent = isReadOnly ? '生徒詳細 (閲覧のみ)' : '生徒詳細';

        const cls = calculateClass(s.birthday);
        const duration = s.joinedDate ? calculateEnrollmentDuration(s.joinedDate) : null;
        const courses = s.courses || (s.classCategory ? [s.classCategory] : []);

        let classBadge = '';
        if (courses.includes('知育')) {
            const rawClass = cls.name.split(' ')[0];
            const ageClass = rawClass.replace('クラス', '') + '知育';
            classBadge += `<span style="font-size: 1rem; background:#fef9c3; color:#854d0e; padding:0.2rem 0.5rem; border-radius:0.5rem; margin-left:0.5rem; border:1px solid #fde047;">${ageClass}</span>`;
        }
        if (courses.includes('HALLO')) classBadge += `<span style="font-size: 1rem; background:#dbeafe; color:#1e40af; padding:0.2rem 0.5rem; border-radius:0.5rem; margin-left:0.5rem; border:1px solid #93c5fd;">HALLO</span>`;
        if (courses.includes('受験')) classBadge += `<span style="font-size: 1rem; background:#fee2e2; color:#991b1b; padding:0.2rem 0.5rem; border-radius:0.5rem; margin-left:0.5rem; border:1px solid #fca5a5;">受験</span>`;
        if (courses.includes('アストルム')) classBadge += `<span style="font-size: 1rem; background:#f3e8ff; color:#6b21a8; padding:0.2rem 0.5rem; border-radius:0.5rem; margin-left:0.5rem; border:1px solid #d8b4fe;">アストルム</span>`;

        // Define all possible courses for dropdown, prioritizing student's enrolled courses
        const allPossibleCourses = ['知育', '受験', 'HALLO', 'アストルム', 'IQテスト'];
        const displayedCourses = [...new Set([...courses, ...allPossibleCourses])];

        const schoolInfo = getSchoolInfo(s.school);

        // Build Actions HTML
        let actionsHTML = '';
        const shareUrl = `${window.location.origin}${window.location.pathname}#share/${s.id}`;

        if (isReadOnly) {
            // Read Only Actions (Assume just Copy Link for further sharing?)
            actionsHTML = `
            <div class="actions">
                <button class="btn-secondary" onclick="copyToClipboard('${shareUrl}')"><i class="ri-link"></i> リンクをコピー</button>
            </div>
        `;
        } else {
            // Full Actions
            actionsHTML = `
            <div class="actions">
                <button class="btn-secondary" onclick="copyToClipboard('${shareUrl}')"><i class="ri-link"></i> リンクをコピー</button>
                <button class="btn-secondary" onclick="window.location.hash='#email/${s.id}'"><i class="ri-mail-send-line"></i> メール作成</button>
                <button class="btn-secondary" onclick="deleteStudent('${s.id}')" style="color: red; border-color: red;">削除</button>
                <button class="btn-primary" onclick="window.location.hash='#edit/${s.id}'">編集</button>
            </div>
        `;
        }

        contentArea.innerHTML = `
        <div class="detail-header">
            <div class="detail-title">
                <div style="font-size: 0.9rem; color: #64748b; margin-bottom: -5px;">${s.kana || ''}</div>
                <h2>${s.name} ${classBadge}</h2>
                <div class="detail-subtitle">ID: ${s.id} | ${getStatusBadge(s.status)} | 担当: ${s.handler || '-'}</div>
            </div>
            ${actionsHTML}
        </div>

        <div class="detail-grid">
            <div class="info-card">
                <h3>基本情報</h3>
                <div class="split-row">
                    <div class="split-left">
                        <div class="info-row"><span class="info-label">生年月日:</span><span class="info-value">${s.birthday}</span></div>
                        <div class="info-row"><span class="info-label">年齢クラス:</span><span class="info-value" style="color:${cls.color === '#f1f5f9' ? '#94a3b8' : 'inherit'}">${cls.name}</span></div>
                        <div class="info-row"><span class="info-label">性別:</span><span class="info-value">${s.gender === 'boy' ? '<i class="ri-men-line" style="color: #3B82F6"></i> 男の子' : '<i class="ri-women-line" style="color: #EC4899"></i> 女の子'}</span></div>
                        
                        <div class="info-row"><span class="info-label">在籍園:</span><span class="info-value">${s.school || '-'}</span></div>
                        ${schoolInfo ? `
                        <div style="margin-top: 0.5rem; margin-bottom: 1rem; padding: 1rem; background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 0.5rem;">
                            <div style="display:flex; align-items:center; gap:0.5rem; margin-bottom:0.5rem; color:#15803d; font-weight:bold; font-size:0.9rem;">
                                <i class="ri-building-2-line"></i> 園の特徴・教育方針
                            </div>
                            <div style="font-weight:bold; margin-bottom:0.25rem; color:#166534;">${schoolInfo.policy}</div>
                            <div style="font-size:0.85rem; color:#14532d; line-height:1.5;">${schoolInfo.description}</div>
                        </div>
                        ` : ''}
                        
                        ${duration ? `<div class="info-row"><span class="info-label">在籍期間:</span><span class="info-value" style="color:green; font-weight:bold;">${duration}</span></div>` : ''}

                        <div style="margin-top: 1rem; padding: 0.75rem 1rem; background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 0.5rem;">
                            <div style="font-weight:bold; color:#0369a1; margin-bottom:0.5rem; display:flex; align-items:center; gap:0.4rem;"><i class="ri-brain-line"></i> IQテスト</div>
                            <div style="display:flex; align-items:center; gap:1rem; flex-wrap:wrap;">
                                <label style="display:flex; align-items:center; gap:0.4rem; cursor:pointer;">
                                    <input type="checkbox" id="iq-done-check" ${s.iqTestDone ? 'checked' : ''} ${isReadOnly ? 'disabled' : ''} onchange="document.getElementById('iq-date-row').style.display=this.checked?'flex':'none'" style="width:16px; height:16px; cursor:pointer;">
                                    <span style="font-size:0.9rem;">実施済み</span>
                                </label>
                                <div id="iq-date-row" style="display:${s.iqTestDone ? 'flex' : 'none'}; align-items:center; gap:0.5rem; flex-wrap:wrap;">
                                    <span style="font-size:0.85rem; color:#475569;">実施日:</span>
                                    <input type="date" id="iq-date-input" value="${s.iqTestDate || ''}" ${isReadOnly ? 'disabled' : ''} style="padding:0.25rem 0.5rem; border:1px solid #bae6fd; border-radius:0.4rem; font-size:0.85rem;">
                                    <span style="font-size:0.85rem; color:#475569; margin-left:0.5rem;">スコア:</span>
                                    <input type="number" id="iq-score-input" value="${s.iqTestScore || ''}" placeholder="数値" ${isReadOnly ? 'disabled' : ''} style="width:70px; padding:0.25rem 0.5rem; border:1px solid #bae6fd; border-radius:0.4rem; font-size:0.85rem;">
                                </div>
                            </div>
                            ${!isReadOnly ? `
                            <div style="display:flex; justify-content:flex-end; margin-top:0.5rem;">
                                <button class="btn-primary" style="padding:0.3rem 0.8rem; font-size:0.8rem; background:#0369a1; border-color:#0369a1;" onclick="saveIqTest('${s.id}')">保存</button>
                            </div>` : ''}
                        </div>
                    </div>
                    <div class="split-right" style="background:#FEF2F2; border:1px solid #FECACA; padding:0.5rem; border-radius:0.5rem;">
                        <div style="font-weight:bold; color:#C53030; margin-bottom:0.5rem;">お子様情報</div>
                        <textarea id="detail-child-notes" style="width:100%; height:150px; padding:1rem; font-size:1rem; line-height:1.5; border:1px solid #FECACA; border-radius:0.5rem; margin-bottom:0.5rem; resize: vertical; background-color: #FFF;" placeholder="お子様の様子、特記事項..." ${isReadOnly ? 'readonly disabled' : ''}>${s.childNotes || ''}</textarea>
                        <div style="display:flex; justify-content:flex-end; gap:0.5rem;">
                            ${!isReadOnly ? `<button class="btn-primary" style="padding:0.4rem 1rem; font-size:0.85rem; background-color: #E53E3E; border-color: #E53E3E;" onclick="saveChildNotes('${s.id}')">保存</button>` : ''}
                            <button class="btn-secondary" style="padding:0.4rem 1rem; font-size:0.85rem;" onclick="copyToClipboard(document.getElementById('detail-child-notes').value)">コピー</button>
                        </div>
                    </div>
                </div>
                
                <h3>保護者情報</h3>
                <div class="split-row">
                    <div class="split-left">
                        <div class="info-row"><span class="info-label">保護者名:</span><span class="info-value">${s.parentName}</span></div>
                        <div class="info-row"><span class="info-label">勤務先:</span><span class="info-value">${s.parentWork || '-'}</span></div>
                        <div class="info-row"><span class="info-label">電話番号:</span><span class="info-value">${s.phone || '-'}</span></div>
                        <div class="info-row"><span class="info-label">Email:</span><span class="info-value">${s.email || '-'}</span></div>
                        <div class="info-row"><span class="info-label">住所:</span><span class="info-value">${s.address || '-'}</span></div>
                    </div>
                    <div class="split-right" style="background:#FEF2F2; border:1px solid #FECACA; padding:0.5rem; border-radius:0.5rem;">
                        <div style="font-weight:bold; color:#C53030; margin-bottom:0.5rem;">保護者特記事項</div>
                        <textarea id="detail-parent-notes" style="width:100%; height:150px; padding:1rem; font-size:1rem; line-height:1.5; border:1px solid #FECACA; border-radius:0.5rem; margin-bottom:0.5rem; resize: vertical; background-color: #FFF;" placeholder="保護者に関する特記事項..." ${isReadOnly ? 'readonly disabled' : ''}>${s.parentNotes || ''}</textarea>
                        <div style="display:flex; justify-content:flex-end; gap:0.5rem;">
                            ${!isReadOnly ? `<button class="btn-primary" style="padding:0.4rem 1rem; font-size:0.85rem; background-color: #E53E3E; border-color: #E53E3E;" onclick="saveParentNotes('${s.id}')">保存</button>` : ''}
                            <button class="btn-secondary" style="padding:0.4rem 1rem; font-size:0.85rem;" onclick="copyToClipboard(document.getElementById('detail-parent-notes').value)">コピー</button>
                        </div>
                    </div>
                </div>

                <h3 style="margin-top: 1.5rem;">体験後メモ</h3>
                <textarea id="detail-post-trial-memo" style="width:100%; height:120px; padding:1rem; font-size:1rem; line-height:1.5; border:1px solid var(--border); border-radius:0.5rem; margin-bottom:0.5rem; resize: vertical; background-color: #FEF9C3;" placeholder="体験の様子や保護者の反応などを入力..." ${isReadOnly ? 'readonly disabled' : ''}>${s.postTrialMemo || ''}</textarea>
                <div style="display:flex; justify-content:flex-end; gap:0.5rem;">
                    ${!isReadOnly ? `<button class="btn-primary" style="padding:0.4rem 1rem; font-size:0.85rem;" onclick="savePostTrialMemo('${s.id}')">保存</button>` : ''}
                    <button class="btn-secondary" style="padding:0.4rem 1rem; font-size:0.85rem;" onclick="copyToClipboard(document.getElementById('detail-post-trial-memo').value)">コピー</button>
                </div>

                <h3 style="margin-top: 1.5rem;">固定授業スケジュール (入会後)</h3>
                <div id="detail-schedule-container" style="background:#f0fdf4; padding:0.5rem; border-radius:0.5rem; border:1px solid #bbf7d0; margin-bottom:0.5rem;">
                    <div style="display:grid; grid-template-columns: 80px 50px 85px 85px 65px 65px; gap:0.5rem; font-size:0.75rem; color:#166534; font-weight:bold; margin-bottom:0.5rem; padding-left:0.5rem;">
                        <div>コース</div><div>曜日</div><div>開始</div><div>終了</div><div>教室</div><div>講師</div>
                    </div>
                    ${[0, 1, 2].map(i => {
            const sch = (s.schedule && s.schedule[i]) ? s.schedule[i] : {};

            // Age Class Logic
            const ageClass = cls ? cls.name.split(' ')[0] : ''; // e.g., "Sクラス"

            // Enhance courses list with specific Age Class if '知育' is present
            let effectiveCourses = [...displayedCourses];
            if (effectiveCourses.includes('知育') && ageClass) {
                // Replace '知育' with specific class or add it
                effectiveCourses = effectiveCourses.map(c => c === '知育' ? ageClass : c);
            }
            // Ensure saved course is in the list
            if (sch.course && !effectiveCourses.includes(sch.course)) {
                effectiveCourses.unshift(sch.course);
            }

            // Auto-select logic: ID '知育' is enrolled, default to Age Class
            let currentCourse = sch.course;
            if (!currentCourse) {
                if (courses.includes('知育') && ageClass) currentCourse = ageClass;
                else if (courses.length === 1) currentCourse = courses[0];
            }

            return `
                        <div class="schedule-slot-row" style="display:grid; grid-template-columns: 80px 50px 85px 85px 65px 65px; gap:0.5rem; margin-bottom:0.5rem;">
                            <select class="slot-course" style="padding:0.3rem;" ${isReadOnly ? 'disabled' : ''} onchange="handleTimeChange(this)">
                                <option value="">-</option>
                                ${effectiveCourses.map(c => `<option value="${c}" ${currentCourse === c ? 'selected' : ''}>${c}</option>`).join('')}
                            </select>
                            <select class="slot-day" style="padding:0.3rem;" ${isReadOnly ? 'disabled' : ''}>
                                <option value="">-</option>
                                ${['火', '水', '木', '金', '土'].map(d => `<option value="${d}" ${sch.day === d ? 'selected' : ''}>${d}</option>`).join('')}
                            </select>
                            <input type="time" class="slot-start" value="${sch.startTime || ''}" style="padding:0.3rem;" ${isReadOnly ? 'disabled' : ''} onclick="if(!this.value) this.value='10:00'" onchange="handleTimeChange(this)">
                            <input type="time" class="slot-end" value="${sch.endTime || ''}" style="padding:0.3rem;" ${isReadOnly ? 'disabled' : ''}>
                            <select class="slot-room" style="padding:0.3rem;" ${isReadOnly ? 'disabled' : ''}>
                                <option value="">-</option>
                                ${['Room1', 'Room2', 'Room3', 'Room4'].map(r => `<option value="${r}" ${sch.room === r ? 'selected' : ''}>${r}</option>`).join('')}
                            </select>
                            <select class="slot-teacher" style="padding:0.3rem;" ${isReadOnly ? 'disabled' : ''}>
                                <option value="">-</option>
                                ${Object.keys(TEACHER_RATES).map(t => `<option value="${t}" ${sch.teacher === t ? 'selected' : ''}>${t}</option>`).join('')}
                            </select>
                        </div>
                        `;
        }).join('')}
                </div>
                <div style="display:flex; justify-content:flex-end; gap:0.5rem;">
                    ${!isReadOnly ? `<button class="btn-primary" style="padding:0.4rem 1rem; font-size:0.85rem;" onclick="saveSchedule('${s.id}')">保存</button>` : ''}
                </div>

                <h3 style="margin-top: 1.5rem;">入会後メモ</h3>
                <textarea id="detail-join-memo" style="width:100%; height:120px; padding:1rem; font-size:1rem; line-height:1.5; border:1px solid var(--border); border-radius:0.5rem; margin-bottom:0.5rem; resize: vertical; background-color: #FEF9C3;" placeholder="入会後の様子、特記事項などを入力..." ${isReadOnly ? 'readonly disabled' : ''}>${s.joinMemo || ''}</textarea>
                <div style="display:flex; justify-content:flex-end; gap:0.5rem;">
                    ${!isReadOnly ? `<button class="btn-primary" style="padding:0.4rem 1rem; font-size:0.85rem;" onclick="saveJoinMemo('${s.id}')">保存</button>` : ''}
                    <button class="btn-secondary" style="padding:0.4rem 1rem; font-size:0.85rem;" onclick="copyToClipboard(document.getElementById('detail-join-memo').value)">コピー</button>
                </div>
            </div>


            <div class="info-card">
                <h3>問合せ時ヒアリング情報</h3>
                <div style="background: #EFF6FF; border:1px solid #DBEAFE; padding: 1rem; border-radius: 0.5rem; margin-bottom: 1.5rem;">
                    <div class="info-row"><span class="info-label">性格:</span><span class="info-value">${s.personality || '-'}</span></div>
                    <div class="info-row"><span class="info-label">習い事:</span><span class="info-value">${s.lessons || '-'}</span></div>
                    <div class="info-row"><span class="info-label">兄弟:</span><span class="info-value">${s.siblings || '-'}</span></div>
                    
                    <div style="margin-top:1rem; font-size:0.85rem; color:var(--text-muted);">問い合わせ経緯・CEに期待すること</div>
                    <div style="font-size:0.95rem; margin-bottom:0.5rem;">${s.inquiryReason || '-'}</div>

                    <div style="margin-top:0.5rem; font-size:0.85rem; color:var(--text-muted);">不安・懸念</div>
                    <div style="font-size:0.95rem; margin-bottom:0.5rem;">${s.concerns || '-'}</div>
                    
                    <div style="margin-top:0.5rem; font-size:0.85rem; color:var(--text-muted);">通うとしたら希望曜日・時間</div>
                    <div style="font-weight:bold; margin-bottom:0.5rem;">${s.preferredSchedule || '-'}</div>

                    <div style="margin-top:0.5rem; font-size:0.85rem; color:var(--text-muted);">来校時ご主人（奥様）も一緒に来校可能か</div>
                    <div style="font-weight:bold;">${s.partnerAttendance || '-'}</div>
                </div>

                <h3>進捗状況</h3>
                <div class="info-row"><span class="info-label">ステータス:</span><span class="info-value" style="font-weight:bold;">${getStatusLabel(s.status)}</span></div>
                <div class="info-row"><span class="info-label">問合わせ日:</span><span class="info-value">${s.inquiryDate}</span></div>

                <div class="info-row">
                    <span class="info-label">体験日時:</span>
                    <span class="info-value">
                        ${s.trialDate ? new Date(s.trialDate).toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '未定'}
                         ${s.trialDate ? `
                            <a href="${generateGoogleCalendarUrl(
            `体験: ${s.name}様`,
            s.trialDate,
            `保護者: ${s.parentName}様\n電話: ${s.phone || '-'}\nコース: ${courses.join(', ')}\n担当: ${s.handler || '-'}\n\n【ヒアリング情報】\n性格: ${s.personality || '-'}\n習い事: ${s.lessons || '-'}\n兄弟: ${s.siblings || '-'}\nタグ: ${(s.tags || []).join(', ') || '-'}\n経緯: ${s.inquiryReason || '-'}\n懸念: ${s.concerns || '-'}\n希望枠: ${s.preferredSchedule || '-'}\n同伴: ${s.partnerAttendance || '-'}\n\n【詳細メモ】\n${s.memo || '-'}`
        )}" target="_blank" style="margin-left:0.5rem; color:#db4437; text-decoration:none; font-size:0.85rem; border:1px solid #e2e8f0; padding:2px 6px; border-radius:4px; display:inline-flex; align-items:center;">
                                <i class="ri-calendar-event-line" style="margin-right:2px;"></i> カレンダー登録
                            </a>
                        ` : ''}
                    </span>
                </div>
                <div class="info-row"><span class="info-label">入会日:</span><span class="info-value">${s.joinedDate || '-'}</span></div>
                
                <h3 style="margin-top: 1.5rem; display:flex; align-items:center; justify-content:space-between;">
                    問合せ時メモ
                    <button class="btn-secondary" style="padding:0.2rem 0.6rem; font-size:0.75rem;" onclick="copyToClipboard('${(s.memo || '').replace(/\r?\n/g, '\\n').replace(/'/g, "\\'")}')">コピー</button>
                </h3>
                <div style="background: #F8FAFC; padding: 1rem; border-radius: 0.5rem; white-space: pre-wrap;">${s.memo || 'なし'}</div>
            </div>
        </div>
    `;

        // Handle Focus Action
        if (focusTarget) {
            setTimeout(() => {
                let elId = null;
                if (focusTarget === 'join-memo') elId = 'detail-join-memo';
                if (focusTarget === 'trial-memo') elId = 'detail-post-trial-memo';

                if (elId) {
                    const el = document.getElementById(elId);
                    if (el) {
                        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        el.focus();
                    }
                }
            }, 300); // Slight delay for rendering
        }
    } catch (e) {
        console.error(e);
        alert('詳細表示エラー: ' + e.message);
    }
}

window.handleTimeChange = function (input) {
    const row = input.parentElement;
    const courseSelect = row.querySelector('.slot-course');
    const startTimeInput = row.querySelector('.slot-start'); // Always get the start input explicitly

    const course = courseSelect.value;
    const startTime = startTimeInput.value;

    if (startTime && (course.includes('知育') || course.includes('HALLO') || course.includes('アストルム') || course.includes('クラス'))) {
        const [h, m] = startTime.split(':').map(Number);
        const startDate = new Date();
        startDate.setHours(h, m);

        // Add 50 minutes
        startDate.setMinutes(startDate.getMinutes() + 50);

        const endH = String(startDate.getHours()).padStart(2, '0');
        const endM = String(startDate.getMinutes()).padStart(2, '0');

        const endInput = row.querySelector('.slot-end');
        if (endInput) {
            // Always update end time for these fixed-duration courses to avoid errors
            // User requested "automtic reflection check again" implying previous check was too strict
            endInput.value = `${endH}:${endM}`;
        }
    }
};

window.saveSchedule = async function (id) {
    const rows = document.querySelectorAll('.schedule-slot-row');
    const scheduleData = [];
    rows.forEach(row => {
        const course = row.querySelector('.slot-course').value;
        const day = row.querySelector('.slot-day').value;
        const startTime = row.querySelector('.slot-start').value;
        const endTime = row.querySelector('.slot-end').value;
        const room = row.querySelector('.slot-room').value;
        const teacher = row.querySelector('.slot-teacher').value;

        if (day && startTime && endTime && course && room && teacher) {
            scheduleData.push({ day, startTime, endTime, course, room, teacher });
        }
    });

    try {
        await updateStudent(id, { schedule: scheduleData });
        alert('スケジュールを保存しました');
    } catch (e) {
        console.error(e);
        alert('保存に失敗しました: ' + e.message);
    }
};

window.savePostTrialMemo = async function (id) {
    const memo = document.getElementById('detail-post-trial-memo').value;
    try {
        await updateStudent(id, { postTrialMemo: memo });
        alert('体験後のメモを保存しました。');
    } catch (e) {
        console.error(e);
        alert('保存に失敗しました: ' + e.message);
    }
};

window.saveJoinMemo = async function saveJoinMemo(id) {
    const val = document.getElementById('detail-join-memo').value;
    try {
        await updateStudent(id, { joinMemo: val });
        alert('保存しました');
    } catch (e) {
        console.error(e);
        alert('保存に失敗しました: ' + e.message);
    }
}

window.saveIqTest = async function (id) {
    const done = document.getElementById('iq-done-check').checked;
    const date = document.getElementById('iq-date-input').value;
    const score = document.getElementById('iq-score-input').value; // Get score
    // Format date as 〇〇年〇月〇日
    let formattedDate = date;
    if (date) {
        const parts = date.split('-');
        if (parts.length === 3) formattedDate = `${parts[0]}年${parseInt(parts[1])}月${parseInt(parts[2])}日`;
    }
    try {
        await updateStudent(id, {
            iqTestDone: done,
            iqTestDate: done ? date : '',
            iqTestDateFormatted: done ? formattedDate : '',
            iqTestScore: done ? score : '' // Save score
        });
        alert('IQテスト情報を保存しました');
    } catch (e) {
        console.error(e);
        alert('保存に失敗しました: ' + e.message);
    }
};

function renderIqList() {
    document.body.classList.remove('view-dashboard', 'view-students');
    pageTitle.textContent = 'IQテスト実施済み一覧';

    const iqStudents = state.students
        .filter(s => s.iqTestDone)
        .sort((a, b) => {
            if (!a.iqTestDate && !b.iqTestDate) return 0;
            if (!a.iqTestDate) return 1;
            if (!b.iqTestDate) return -1;
            return new Date(b.iqTestDate) - new Date(a.iqTestDate);
        });

    contentArea.innerHTML = `
        <div class="data-table-container">
            <div style="padding: 1.5rem; display:flex; align-items:center; justify-content:space-between; background:#f0f9ff; border-bottom:1px solid #bae6fd;">
                <div style="display:flex; align-items:center; gap:0.75rem;">
                    <i class="ri-brain-line" style="font-size:1.5rem; color:#0369a1;"></i>
                    <div>
                        <div style="font-size:1.1rem; font-weight:bold; color:#0369a1;">IQテスト実施済み生徒</div>
                        <div style="font-size:0.85rem; color:#0284c7;">計 ${iqStudents.length} 名</div>
                    </div>
                </div>
            </div>
            <table>
                <thead><tr>
                    <th>実施日</th>
                    <th>次回予定</th>
                    <th style="min-width:160px;">生徒名</th>
                    <th>スコア</th>
                    <th>生年月日</th>
                    <th>年齢クラス</th>
                    <th>コース</th>
                    <th>ステータス</th>
                    <th>担当</th>
                </tr></thead>
                <tbody>
                ${iqStudents.length === 0 ? '<tr><td colspan="9" style="text-align:center; padding:2rem; color:#94a3b8;">IQテスト実施済みの生徒はいません</td></tr>' : iqStudents.map(s => {
        const cls = calculateClass(s.birthday);
        const courses = s.courses || (s.classCategory ? [s.classCategory] : []);
        const birthdayDisplay = s.birthday ? (() => { const p = s.birthday.split('-'); return p.length === 3 ? `${p[0]}年${parseInt(p[1])}月${parseInt(p[2])}日` : s.birthday; })() : '-';

        // Calculate Next Test Date
        let nextTestDisplay = '-';
        if (s.iqTestDate) {
            const d = new Date(s.iqTestDate);
            d.setFullYear(d.getFullYear() + 1);
            nextTestDisplay = `<span style="color:#0284c7; font-weight:bold;">${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日</span>`;
        }

        let badgesHTML = '';
        if (courses.includes('知育')) badgesHTML += `<span class="badge" style="background:#fef9c3; color:#854d0e;">${cls.name.split(' ')[0].replace('クラス', '')}知育</span>`;
        if (courses.includes('HALLO')) badgesHTML += `<span class="badge" style="background:#dbeafe; color:#1e40af;">HALLO</span>`;
        if (courses.includes('受験')) badgesHTML += `<span class="badge" style="background:#fee2e2; color:#991b1b;">受験</span>`;
        if (courses.includes('アストルム')) badgesHTML += `<span class="badge" style="background:#f3e8ff; color:#6b21a8;">アスト</span>`;
        const statusStyle = STATUS_DEFINITIONS.find(d => d.value === s.status) || { color: '#333', bg: '#fff' };
        const statusBadge = `<span style="padding:0.2rem 0.6rem; border-radius:0.25rem; font-size:0.8rem; background:${statusStyle.bg}; color:${statusStyle.color}; border:1px solid ${statusStyle.color}; font-weight:500;">${statusStyle.label}</span>`;
        return `<tr onclick="window.location.hash='#detail/${s.id}'" style="cursor:pointer;">
                        <td style="white-space:nowrap; font-weight:500; color:#475569;">${s.iqTestDateFormatted || s.iqTestDate || '-'}</td>
                        <td style="white-space:nowrap; font-size:0.9rem;">${nextTestDisplay}</td>
                        <td>${s.name}<div style="font-size:0.75rem; color:#64748b;">${s.kana || ''}</div></td>
                        <td style="font-weight:bold; color:#0f766e; font-size:1.1rem;">${s.iqTestScore || '-'}</td>
                        <td style="font-size:0.85rem; color:#475569; white-space:nowrap;">${birthdayDisplay}</td>
                        <td style="font-size:0.85rem;">${cls.name}</td>
                        <td><div style="display:flex;gap:2px;flex-wrap:wrap;">${badgesHTML}</div></td>
                        <td>${statusBadge}</td>
                        <td>${s.handler || '-'}</td>
                    </tr>`;
    }).join('')}
                </tbody>
            </table>
        </div>
    `;
};

window.saveChildNotes = async function (id) {
    const memo = document.getElementById('detail-child-notes').value;
    try {
        await updateStudent(id, { childNotes: memo });
        alert('お子様情報を保存しました。');
    } catch (e) {
        console.error(e);
        alert('保存に失敗しました: ' + e.message);
    }
};

window.saveParentNotes = async function (id) {
    const memo = document.getElementById('detail-parent-notes').value;
    try {
        await updateStudent(id, { parentNotes: memo });
        alert('保護者特記事項を保存しました。');
    } catch (e) {
        console.error(e);
        alert('保存に失敗しました: ' + e.message);
    }
};


// School Functions
function renderSchoolList() {
    pageTitle.textContent = '園DB';
    contentArea.innerHTML = `
        <div class="data-table-container">
            <div style="padding:1.5rem;"><button class="btn-primary" onclick="window.location.hash='#school_edit'">新規登録</button></div>
            <table>
                <thead><tr><th>園名</th><th>キーワード</th><th>特徴</th><th>操作</th></tr></thead>
                <tbody>
                ${state.schools.map(s => `<tr>
                    <td><b>${s.name}</b></td>
                    <td>${(s.keywords || []).join(', ')}</td>
                    <td>${s.policy}</td>
                    <td><button onclick="window.location.hash='#school_edit/${s.id}'">編集</button> <button onclick="deleteSchool('${s.id}')" style="color:red">削除</button></td>
                </tr>`).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function renderSchoolForm(id = null) {
    const isEdit = !!id;
    const data = isEdit ? state.schools.find(s => s.id === id) : {};
    pageTitle.textContent = isEdit ? '園編集' : '園登録';

    contentArea.innerHTML = `
        <form id="school-form" class="form-container">
            <div class="form-group"><label>園名</label><input type="text" name="name" value="${data.name || ''}" required></div>
            <div class="form-group"><label>キーワード (カンマ区切り)</label><input type="text" name="keywords" value="${(data.keywords || []).join(',')}" placeholder="例: さくら, 桜, sakura"></div>
            <div class="form-group"><label>方針</label><input type="text" name="policy" value="${data.policy || ''}"></div>
            <div class="form-group"><label>詳細</label><textarea name="description">${data.description || ''}</textarea></div>
            <button type="submit" class="btn-primary">保存</button>
        </form>
    `;

    document.getElementById('school-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const keywords = fd.get('keywords').split(',').map(k => k.trim()).filter(k => k);
        const submitData = { name: fd.get('name'), policy: fd.get('policy'), description: fd.get('description'), keywords: keywords };
        if (isEdit) await updateSchool(id, submitData);
        else await addSchool(submitData);
        window.location.hash = '#schools';
    });
}


// --- Helper Functions ---
function calculateClass(birthdayStr) {
    if (!birthdayStr) return { name: '-', color: '#f1f5f9', textColor: '#64748b', borderColor: '#cbd5e1' };
    const birthDate = new Date(birthdayStr);
    for (const def of CLASS_DEFINITIONS) {
        const start = new Date(def.startYear, 3, 2);
        const end = new Date(def.endYear, 3, 1);
        if (birthDate >= start && birthDate <= end) {
            return { name: def.name, color: '#fef9c3', textColor: '#854d0e', borderColor: '#fde047' };
        }
    }
    return { name: '規定外', color: '#f1f5f9', textColor: '#64748b', borderColor: '#cbd5e1' };
}

function calculateEnrollmentDuration(joinedDateStr) {
    if (!joinedDateStr) return null;
    const joined = new Date(joinedDateStr);
    const now = new Date();
    let months = (now.getFullYear() - joined.getFullYear()) * 12;
    months -= joined.getMonth();
    months += now.getMonth();
    if (months <= 0) return '初月';
    return `${months}ヶ月目`;
}
function getStatusBadge(st) {
    const s = STATUS_DEFINITIONS.find(d => d.value === st);
    if (s) return `<span class="badge" style="background:${s.bg}; color:${s.color}">${s.label}</span>`;
    return st;
}
function getStatusLabel(st) { return getStatusBadge(st); }

// --- Calendar Logic ---
function renderCalendar() {
    pageTitle.textContent = '週間スケジュール (火〜土)';
    document.body.classList.remove('view-dashboard', 'view-students');

    // Config
    const days = ['火', '水', '木', '金', '土'];
    const rooms = ['Room1', 'Room2', 'Room3', 'Room4'];
    const startHour = 9;
    const endHour = 20; // Changed to 20 to include 19:00 as the last hour label
    const stepMin = 15; // Grid resolution
    const stepsPerHour = 60 / stepMin;
    const totalRows = (endHour - startHour) * stepsPerHour;

    // 1. Group Schedule Data & Calculate Teacher Costs
    // Map key: "Day_Room_TimeStart" -> { ...details, students: [] }
    const scheduleMap = new Map();
    const teacherDailyCosts = {}; // { Day: { Teacher: Cost } }
    const dailyStudentCounts = {}; // To count total students per day

    days.forEach(d => {
        teacherDailyCosts[d] = {};
        dailyStudentCounts[d] = 0;
    });

    // To avoid duplication in per-day count if we want "total heads in building" 
    // BUT user said "Class lesson e.g. 3 people" should be reflected.
    // Let's count student-slots (the number of students assigned to ALL slots on that day).
    state.students.forEach(s => {
        if (s.schedule && Array.isArray(s.schedule)) {
            s.schedule.forEach(sch => {
                if (!days.includes(sch.day)) return;
                dailyStudentCounts[sch.day]++;
            });
        }
    });

    state.students.forEach(s => {
        if (s.schedule && Array.isArray(s.schedule)) {
            s.schedule.forEach(sch => {
                if (!days.includes(sch.day)) return;

                // Create Unique Key for the slot (same day, room, start, end, course, teacher)
                // Note: We group by these fields so students in the same class appear together.
                const key = `${sch.day}_${sch.room}_${sch.startTime}_${sch.endTime}_${sch.course}_${sch.teacher}`;

                if (!scheduleMap.has(key)) {
                    scheduleMap.set(key, {
                        day: sch.day,
                        room: sch.room,
                        startTime: sch.startTime,
                        endTime: sch.endTime,
                        course: sch.course,
                        teacher: sch.teacher,
                        students: []
                    });
                }
                scheduleMap.get(key).students.push({ name: s.name, id: s.id, status: s.status });
            });
        }
    });

    // Calculate Costs based on Unique Slots (not per student)
    scheduleMap.forEach(slot => {
        if (slot.teacher && slot.startTime && slot.endTime) {
            const startParts = slot.startTime.split(':');
            const endParts = slot.endTime.split(':');
            const start = parseInt(startParts[0]) + parseInt(startParts[1]) / 60;
            const end = parseInt(endParts[0]) + parseInt(endParts[1]) / 60;
            const duration = end - start;

            const rate = getWageRate(slot.teacher, slot.day, slot.course);
            if (rate > 0) {
                if (!teacherDailyCosts[slot.day][slot.teacher]) teacherDailyCosts[slot.day][slot.teacher] = 0;
                teacherDailyCosts[slot.day][slot.teacher] += duration * rate;
            }
        }
    });

    // 2. Render HTML
    // We use a large grid:
    // Columns: [TimeLabel] [Day1-Room1] [Day1-Room2]... [Day2-Room1]...
    // But to handle "Tuesday to Saturday", maybe grouping by Day is better visually.
    // Let's create a Flex container for Days, each Day has a Grid for Rooms.

    const timeLabels = [];
    const pixelPerMinute = 2; // Reverted to 2 (120px/h) as requested
    const hourHeight = 60 * pixelPerMinute;

    // Add extra padding at top so 9:00 lines up correctly
    // The grid starts at startHour (9:00). We need to align the labels.
    for (let h = startHour; h < endHour; h++) {
        timeLabels.push(`<div class="time-label" style="top:${(h - startHour) * hourHeight}px">${h}:00</div>`);
    }

    const renderDayColumn = (day) => {
        const daySlots = Array.from(scheduleMap.values()).filter(s => s.day === day);

        const roomCols = rooms.map(room => {
            const roomSlots = daySlots.filter(s => s.room === room);
            const slotsHtml = roomSlots.map(slot => {
                const [sh, sm] = slot.startTime.split(':').map(Number);
                const [eh, em] = slot.endTime.split(':').map(Number);

                // Calculate position relative to startHour (9:00)
                const startMin = ((sh - startHour) * 60 + sm) * pixelPerMinute;
                const endMin = ((eh - startHour) * 60 + em) * pixelPerMinute;
                const height = endMin - startMin;

                const hasSuspendedStudent = slot.students.some(st => st.status === 'suspended');

                // Color coding by Course (rough logic)
                let bgColor = '#eff6ff'; // blueish (HALLO)
                let brdColor = '#2563eb';

                if (hasSuspendedStudent) {
                    bgColor = '#dcfce7'; brdColor = '#16a34a'; // 休会中の生徒がいれば緑色
                } else if (['知育', 'PD', 'D', 'T', 'Q', 'C', 'S'].some(k => slot.course.includes(k))) {
                    bgColor = '#fef9c3'; brdColor = '#d97706';
                }

                if (slot.course.includes('受験')) { bgColor = '#fee2e2'; brdColor = '#dc2626'; }
                if (slot.course.includes('アストルム')) { bgColor = '#f3e8ff'; brdColor = '#7c3aed'; }

                return `
                    <div class="slot-card" style="top:${startMin}px; height:${height}px; background:${bgColor}; border-left:4px solid ${brdColor};" onclick="alert('${slot.course}\\n${slot.teacher}\\n\\n生徒:\\n${slot.students.map(s => s.name).join('\\n')}')">
                         <div class="slot-course" style="color:${brdColor};">${slot.course} (${slot.students.length}名)</div>
                         <div class="slot-students">
                            ${slot.students.map(s => `<div class="slot-student" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; line-height:1.1; cursor:pointer; color:#1d4ed8;" onclick="console.log('Click student: ${s.id}'); if(window.renderDetail) window.renderDetail('${s.id}'); else alert('Error: renderDetail not found'); event.stopPropagation();" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">${s.name}</div>`).join('')}
                         </div>
                         <div class="slot-teacher">
                            <span style="background:#fff; border:1px solid #ccc; padding:1px 6px; border-radius:4px; font-weight:bold; font-size:0.8rem; box-shadow:0 1px 2px rgba(0,0,0,0.1); color:#333;"><i class="ri-user-star-line"></i> ${slot.teacher}</span>
                         </div>
                    </div>
                `;
            }).join('');

            return `<div class="room-col" data-room="${room}">${slotsHtml}</div>`;
        }).join('');

        // Cost Summary for Day

        const costs = teacherDailyCosts[day];
        const totalDailyCost = Object.values(costs).reduce((a, b) => a + b, 0);

        const costSummaryHtml = Object.keys(costs).length > 0
            ? `<div class="day-cost">
                <div style="font-weight:bold; margin-bottom:0.25rem; border-bottom:1px solid #bbf7d0; padding-bottom:0.2rem;">想定人件費: ¥${Math.round(totalDailyCost).toLocaleString()}</div>
                ${Object.entries(costs).map(([t, c]) => `<div>${t}: ¥${Math.round(c).toLocaleString()}</div>`).join('')}
               </div>`
            : '<div class="day-cost" style="color:#aaa;">-</div>';


        return `
            <div class="day-section">
                <div class="day-header">
                    ${day}曜日 
                    <div style="font-size:1.1rem; font-weight:bold; margin-left:0.75rem; color:var(--primary); background:rgba(37,99,235,0.1); padding:2px 8px; border-radius:6px; border:1px solid rgba(37,99,235,0.2);">
                        ${dailyStudentCounts[day]}名
                    </div>
                </div>
                <div class="room-headers-row">
                    ${rooms.map(r => `<div class="rh">${r.replace('Room', '')}</div>`).join('')}
                </div>
                <div class="day-body" style="height:${(endHour - startHour) * hourHeight}px;">
                    ${roomCols}
                    <!-- Horizontal Grid Lines -->
                    ${Array.from({ length: endHour - startHour }).map((_, i) => `<div class="grid-line" style="top:${i * hourHeight}px"></div>`).join('')}
                    <!-- 9:00 line specifically -->
                    <div class="grid-line" style="top:0px; border-top:1px solid #cbd5e1;"></div>
                </div>
                ${costSummaryHtml}
            </div>
        `;
    };

    contentArea.innerHTML = `
        <style>
            .calendar-wrapper { display: flex; overflow-x: auto; padding-bottom: 2rem; background: #fff; position: relative; }
            .time-column { width: 50px; flex-shrink: 0; position: sticky; left: 0; background: #fff; z-index: 10; border-right: 1px solid #ddd; display: flex; flex-direction: column; } 
            .time-header-top { height: 40px; background: #f1f5f9; border-bottom: 1px solid #e2e8f0; }
            .time-header-bottom { height: 30px; display: flex; align-items: center; justify-content: center; font-size: 0.75rem; font-weight: bold; background: #f8fafc; border-bottom: 1px solid #e2e8f0; color: #64748b; }
            .time-labels-body { position: relative; flex: 1; }
            .time-label { position: absolute; width: 100%; text-align: right; padding-right: 5px; font-size: 0.75rem; color: #666; transform: translateY(-50%); border-top: 1px solid #eee; height:0; }
            
            .day-section { border-right: 2px solid #cbd5e1; flex-shrink: 0; width: 440px; display: flex; flex-direction: column; }
            .day-header { height: 40px; display:flex; align-items:center; justify-content:center; font-weight: bold; background: #f1f5f9; border-bottom: 1px solid #e2e8f0; position:sticky; top:0; z-index:5; box-sizing: border-box; }
            .room-headers-row { height: 30px; display: flex; border-bottom: 1px solid #e2e8f0; background:#f8fafc; box-sizing: border-box; }
            .rh { flex: 1; display:flex; align-items:center; justify-content:center; font-size: 0.8rem; border-right: 1px solid #eee; }
            .rh:last-child { border-right: none; }

            .day-body { position: relative; display: flex; }
            .room-col { flex: 1; position: relative; border-right: 1px solid #f1f5f9; }
            .room-col:last-child { border-right: none; }
            
            .grid-line { position: absolute; left: 0; width: 100%; height: 1px; background: #e2e8f0; pointer-events: none; opacity:0.5; }

            .slot-card { 
                position: absolute; width: 94%; left: 3%; padding: 4px; border-radius: 4px; overflow: hidden; 
                display:flex; flex-direction:column; box-shadow: 0 1px 2px rgba(0,0,0,0.1); cursor: pointer; 
                transition: z-index 0.2s, box-shadow 0.2s, transform 0.2s;
                font-size: 0.75rem; line-height: 1.2; color: #1e293b;
            }
            .slot-card:hover { 
                z-index: 100; overflow:visible; height:auto !important; min-height: fit-content; 
                box-shadow: 0 8px 16px rgba(0,0,0,0.2); transform: scale(1.02); 
            }
            .slot-course { font-weight: bold; text-align: center; margin-bottom: 2px; font-size: 0.7rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
            .slot-student { margin-bottom: 2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
            .slot-teacher { margin-top:auto; padding-top:4px; display:flex; justify-content:center; }
            .slot-students { padding-right: 2px; line-height:1.2; margin-bottom: 4px; display:flex; flex-direction:column; }

            .day-cost { padding: 0.5rem; background: #f0fdf4; font-size: 0.75rem; border-top: 1px solid #bbf7d0; min-height: 50px; }
        </style>

        <div class="calendar-wrapper">
            <div class="time-column">
                <div class="time-header-top"></div>
                <div class="time-header-bottom">時間</div>
                <div class="time-labels-body">
                    ${timeLabels.join('')}
                </div>
            </div>
            ${days.map(d => renderDayColumn(d)).join('')}
        </div>

        <div style="margin-top:2rem; padding:1rem; background:#fff; border:1px solid #ddd; border-radius:0.5rem;">
            <h3 style="margin-bottom:1rem; font-size:1rem; border-bottom:2px solid #166534; padding-bottom:0.5rem; color:#166534;">週間人件費・コマ数集計</h3>
            <table style="width:100%; border-collapse:collapse; font-size:0.9rem;">
                <thead>
                    <tr style="background:#f1f5f9; text-align:left;">
                        <th style="padding:0.5rem; border:1px solid #ddd;">講師名</th>
                        <th style="padding:0.5rem; border:1px solid #ddd;">総コマ数</th>
                        <th style="padding:0.5rem; border:1px solid #ddd;">総稼働時間</th>
                        <th style="padding:0.5rem; border:1px solid #ddd;">総人件費</th>
                    </tr>
                </thead>
                <tbody>
                    ${(() => {
            const stats = {};
            scheduleMap.forEach(slot => {
                if (slot.teacher && slot.startTime && slot.endTime) {
                    const wage = getWageRate(slot.teacher, slot.day, slot.course);
                    if (wage > 0) {
                        if (!stats[slot.teacher]) stats[slot.teacher] = { count: 0, hours: 0, cost: 0 };

                        const [sh, sm] = slot.startTime.split(':').map(Number);
                        const [eh, em] = slot.endTime.split(':').map(Number);
                        const duration = (eh + em / 60) - (sh + sm / 60);

                        stats[slot.teacher].count += 1;
                        stats[slot.teacher].hours += duration;
                        stats[slot.teacher].cost += duration * wage;
                    }
                }
            });

            // Calculate Totals
            let totalCount = 0;
            let totalHours = 0;
            let totalCost = 0;

            const rows = Object.entries(stats).map(([t, s]) => {
                totalCount += s.count;
                totalHours += s.hours;
                totalCost += s.cost;
                return `
                             <tr>
                                <td style="padding:0.5rem; border:1px solid #ddd;">${t}</td>
                                <td style="padding:0.5rem; border:1px solid #ddd;">${s.count}</td>
                                <td style="padding:0.5rem; border:1px solid #ddd;">${s.hours.toFixed(1)}h</td>
                                <td style="padding:0.5rem; border:1px solid #ddd;">¥${Math.abs(Math.round(s.cost)).toLocaleString()}</td>
                             </tr>
                             `;
            }).join('');

            const footer = `
                            <tr style="font-weight:bold; background:#f0fdf4;">
                                <td style="padding:0.5rem; border:1px solid #ddd;">合計</td>
                                <td style="padding:0.5rem; border:1px solid #ddd;">${totalCount}</td>
                                <td style="padding:0.5rem; border:1px solid #ddd;">${totalHours.toFixed(1)}h</td>
                                <td style="padding:0.5rem; border:1px solid #ddd;">¥${Math.abs(Math.round(totalCost)).toLocaleString()}</td>
                            </tr>
                        `;

            return rows + footer;
        })()}
                </tbody>
            </table>
        </div>
    `;
}

// --- Global Export ---
window.init = init;
window.renderDetail = renderDetail;
init();
