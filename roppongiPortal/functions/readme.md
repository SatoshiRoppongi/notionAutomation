## 構成

* そんなに増える想定ではないのでシンプルな構成・必要最低限
  * もし増えるようであれば、ディレクトリ構成を再検討する。

## デプロイ方法

### 関数をまとめてデプロイしたい場合

```
firebase deploy --only functions
```

### 関数 hoge をデプロイしたい場合

```
firebase deploy --only functions:hoge
```

