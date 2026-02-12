# Vocab Battle（語彙パーツバトル）

このプロジェクトは、あなたの設計（HPバトル / パーツ選択 / 5段階AI / 速度+コンボダメージ）を、
**Expo（React Native）**で動く形にしたMVPです。

## 初心者向けに一言
- これは **iOS/Android両対応**のコード。
- 見た目はシンプルでも、ゲームの核（ターン/ダメージ/AI/進捗保存）は実装済み。
- ゲームを強くする一番の方法は「単語データ（辞書）を増やす」こと。

---

## スマホだけで動かす最短ルート
スマホだけでやるなら、ブラウザで使える **GitHub Codespaces**（クラウド上のPC）を使うのが最短です。

### 1) GitHubにアップロード
1. GitHubで新規リポジトリを作る
2. このフォルダの中身をリポジトリに入れる

### 2) Codespacesを起動
リポジトリ画面 → **Code** → **Codespaces** → **Create codespace**

### 3) 起動（プレビュー）
Codespacesのターミナルで：
```bash
npm install
npx expo start
```

### 4) 自分のスマホで動かす
1. スマホに **Expo Go** をインストール
2. `npx expo start` で出たQRを読み込む

---

## ストア審査（iOS/Android）に出すときの考え方
このコードは **EAS（Expoのクラウドビルド）** を想定しています。

### 必要なもの（あなた名義）
- Apple Developer Program
- Google Play Console

### ビルド（クラウド）
Codespacesのターミナルで：
```bash
npx eas-cli login
npx eas-cli build --platform android --profile production
npx eas-cli build --platform ios --profile production
```

※ `app.json` の bundleIdentifier / package はあなたのものに変更が必要です。

---

## 広告について
いまは「課金なし・広告なし」前提で審査が通りやすい設計です。
広告を入れるときは、AdMob等のSDKを追加して、ストアの「データ収集」申告も更新します。
