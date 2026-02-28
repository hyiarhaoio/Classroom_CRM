# Security Setup for Classroom CRM

Netlifyで公開したアプリを安全に運用するために、以下の2つの設定を必ず確認・実行してください。

## 1. Firebase Firestore セキュリティルールの設定 (重要)

URLを知っていても、データそのものにアクセスできないようにするための**最重要**設定です。

1. [Firebase Console](https://console.firebase.google.com/) にログイン
2. **Firestore Database** > **ルール (Rules)** タブを開く
3. 以下のルールを貼り付けて公開してください（あなたのメールアドレスのみに制限します）：

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      // あなたのメールアドレス（hyiarhaoio@gmail.com）のみ読み書きを許可
      allow read, write: if request.auth != null && request.auth.token.email == "hyiarhaoio@gmail.com";
    }
  }
}
```

## 2. フロントエンドのホワイトリスト (実施済み)

`main.js` にて、`ALLOWED_EMAILS` リストに含まれないメールアドレスでのログインを拒否する設定を追加しました。

## 3. GitHub リポジトリの非公開化 (推奨)

もし GitHub リポジトリが「Public」になっている場合、ソースコード（とNetlifyのURL）が誰でも見れる状態です。
情報をより守るために、リポジトリの **Settings > General > Danger Zone > Change visibility** から「Private」に変更することをお勧めします。

## 4. Netlify サイトパスワード (オプション)

Netlifyの有料プラン（または特定の構成）では、サイト全体にパスワードをかけることも可能です。
現在の無料プランでも、上記の Firebase ルールが設定されていれば、データが盗まれることはありませんのでご安心ください。
