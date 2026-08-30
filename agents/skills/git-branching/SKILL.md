---
name: git-branching
description: GIT BRANCHING SKILL - Git Flow branching strategy (main/develop/feature/bugfix/release/hotfix), git-flow commands, manual equivalents, and best practices. Read this skill before any git branching work.
---

# GIT BRANCHING STRATEGY GUIDE
## Git Branching hiệu quả

- **main**: production

- **develop**: tích hợp các tính năng

- **feature/**: phát triển tính năng

- **bugfix/**: sửa lỗi trong quá trình phát triển

- **release/**: chuẩn bị phát hành

- **hotfix/**: sửa lỗi khẩn cấp trên production

Ví dụ mẫu:

```mermaid
gitGraph
    commit id: "Initial Project"

    branch develop
    checkout develop
    commit id: "Setup MCP Server"
    commit id: "Add Embedding Manager"

    branch feature/vietnamese-text
    checkout feature/vietnamese-text
    commit id: "Vietnamese Chunker"
    commit id: "Text Processing"

    checkout develop
    merge feature/vietnamese-text
    commit id: "Merge Vietnamese Support"

    branch feature/batch-processing
    checkout feature/batch-processing
    commit id: "Batch Processor"
    commit id: "Memory Optimization"
    commit id: "Performance Metrics"

    checkout develop
    merge feature/batch-processing
    commit id: "Merge Batch Processing"

    branch main
    checkout main
    commit id: "Production v1.0"

    checkout develop
    commit id: "Error Handling"
    commit id: "Input Validation"

    branch hotfix/fix-psutil-import
    checkout hotfix/fix-psutil-import
    commit id: "Fix psutil import error"
    commit id: "Resolve conflicts"
    commit id: "Update .gitignore"

    checkout main
    merge hotfix/fix-psutil-import
    commit id: "Hotfix Applied"

    checkout develop
    merge main
    commit id: "Sync with Main"

    branch feature/security-enhancements
    checkout feature/security-enhancements
    commit id: "Security Validation"
    commit id: "Audit Logging"

    checkout develop
    branch release/v2.0
    checkout release/v2.0
    commit id: "Prepare Release"
    commit id: "Documentation"
    commit id: "Final Testing"

    checkout main
    merge release/v2.0
    commit id: "Production v2.0"

    checkout develop
    merge release/v2.0
    commit id: "Release Merged Back"
```

## Khởi tạo Git Flow

### Cài đặt Git Flow
```bash
# Windows (với Chocolatey)
choco install git-flow-avh

# Windows (với Git for Windows - thường đã có sẵn)
# Kiểm tra: git flow version

# macOS
brew install git-flow-avh

# Ubuntu/Debian
apt-get install git-flow
```

### Khởi tạo Git Flow trong dự án
```bash
# Khởi tạo với cấu hình mặc định
git flow init

# Hoặc khởi tạo với các giá trị mặc định (không hỏi)
git flow init -d
```

**Cấu hình khuyến nghị**:
- Production branch: `main`
- Development branch: `develop`
- Feature branch prefix: `feature/`
- Bugfix branch prefix: `bugfix/`
- Release branch prefix: `release/`
- Hotfix branch prefix: `hotfix/`
- Version tag prefix: (để trống hoặc `v`)

---

## Các lệnh Git Flow chi tiết

### 1. Feature - Phát triển tính năng mới

```bash
# Bắt đầu feature mới (tạo từ develop)
git flow feature start <feature-name>
# Ví dụ: git flow feature start vietnamese-text

# Publish feature lên remote (để làm việc nhóm)
git flow feature publish <feature-name>

# Pull feature từ remote
git flow feature pull origin <feature-name>

# Hoàn thành feature (merge vào develop)
git flow feature finish <feature-name>

# Liệt kê tất cả features
git flow feature list
```

**Ví dụ thực tế:**
```bash
# Tạo feature xử lý text tiếng Việt
git flow feature start vietnamese-text

# Code... commit...
git add .
git commit -m "Add Vietnamese chunker"
git commit -m "Add text processing"

# Hoàn thành và merge vào develop
git flow feature finish vietnamese-text
```

---

### 2. Release - Chuẩn bị phát hành

```bash
# Bắt đầu release (tạo từ develop)
git flow release start <version>
# Ví dụ: git flow release start 1.0.0

# Publish release lên remote
git flow release publish <version>

# Hoàn thành release (merge vào main VÀ develop, tạo tag)
git flow release finish <version>

# Push tags lên remote
git push origin --tags

# Liệt kê tất cả releases
git flow release list
```

**Ví dụ thực tế:**
```bash
# Chuẩn bị release v2.0.0
git flow release start 2.0.0

# Sửa lỗi nhỏ, cập nhật docs, test...
git commit -m "Prepare release documentation"
git commit -m "Final testing"

# Hoàn thành release
git flow release finish 2.0.0

# Push tất cả
git push origin develop
git push origin main
git push origin --tags
```

---

### 3. Bugfix - Sửa lỗi trong quá trình phát triển

```bash
# Bắt đầu bugfix (tạo từ develop)
git flow bugfix start <bugfix-name>
# Ví dụ: git flow bugfix start fix-login-validation

# Publish bugfix lên remote
git flow bugfix publish <bugfix-name>

# Hoàn thành bugfix (merge vào develop)
git flow bugfix finish <bugfix-name>

# Liệt kê tất cả bugfixes
git flow bugfix list
```

**Ví dụ thực tế:**
```bash
# Sửa lỗi validation trong login
git flow bugfix start fix-login-validation

# Sửa lỗi
git commit -m "Fix login validation error"
git commit -m "Add unit tests"

# Hoàn thành bugfix
git flow bugfix finish fix-login-validation
```

> **Lưu ý**: `bugfix/` khác với `hotfix/`:
> - `bugfix/`: Sửa lỗi trong quá trình phát triển (tạo từ `develop`)
> - `hotfix/`: Sửa lỗi khẩn cấp trên production (tạo từ `main`)

---

### 4. Hotfix - Sửa lỗi khẩn cấp trên production

```bash
# Bắt đầu hotfix (tạo từ main)
git flow hotfix start <version>
# Ví dụ: git flow hotfix start 1.0.1

# Hoàn thành hotfix (merge vào main VÀ develop, tạo tag)
git flow hotfix finish <version>

# Liệt kê tất cả hotfixes
git flow hotfix list
```

**Ví dụ thực tế:**
```bash
# Phát hiện bug critical trên production
git flow hotfix start fix-psutil-import

# Sửa lỗi
git commit -m "Fix psutil import error"
git commit -m "Update .gitignore"

# Hoàn thành hotfix
git flow hotfix finish fix-psutil-import

# Push tất cả
git push origin develop
git push origin main
git push origin --tags
```

---

### 5. Support (Tùy chọn) - Hỗ trợ phiên bản cũ

```bash
# Bắt đầu support branch cho phiên bản cũ
git flow support start <version> <base>
# Ví dụ: git flow support start 1.x v1.0.0
```

---

## Lệnh Git thủ công (không dùng git-flow)

Nếu không cài git-flow, bạn có thể dùng lệnh git thuần:

### Feature
```bash
# Bắt đầu feature
git checkout develop
git checkout -b feature/vietnamese-text

# Hoàn thành feature
git checkout develop
git merge --no-ff feature/vietnamese-text
git branch -d feature/vietnamese-text
```

### Bugfix
```bash
# Bắt đầu bugfix
git checkout develop
git checkout -b bugfix/fix-login-validation

# Hoàn thành bugfix
git checkout develop
git merge --no-ff bugfix/fix-login-validation
git branch -d bugfix/fix-login-validation
```

### Release
```bash
# Bắt đầu release
git checkout develop
git checkout -b release/2.0.0

# Hoàn thành release
git checkout main
git merge --no-ff release/2.0.0
git tag -a v2.0.0 -m "Release version 2.0.0"

git checkout develop
git merge --no-ff release/2.0.0
git branch -d release/2.0.0
```

### Hotfix
```bash
# Bắt đầu hotfix
git checkout main
git checkout -b hotfix/fix-critical-bug

# Hoàn thành hotfix
git checkout main
git merge --no-ff hotfix/fix-critical-bug
git tag -a v1.0.1 -m "Hotfix v1.0.1"

git checkout develop
git merge --no-ff hotfix/fix-critical-bug
git branch -d hotfix/fix-critical-bug
```

---

## Workflow tổng quan

```
main ───────●─────────────────────●────────●──────
            │                     ↑        ↑
            │                     │        │
hotfix      │                     │   ●────┘
            │                     │   │
            ↓                     │   │
develop ────●────●────●────●──────●───●────●──────
                 │    ↑    │      ↑
                 │    │    │      │
feature/bugfix   ●────┘    ●──────┘
```

## Xác thực GitHub khi push

- Trong môi trường agent container, `GITHUB_TOKEN` có sẵn trong
  environment. Runner đã cấu hình sẵn remote `origin` nhúng token
  (`https://x-access-token:<token>@github.com/...`), nên `git push`
  hoạt động trực tiếp, không cần `gh auth login`.
- Nếu push bị từ chối (HTTP 403/401): kiểm tra
  `git remote -v` có chứa `x-access-token` không; token hết hạn, hoặc
  thiếu scope `Contents: Read and write` cho repo đó.
- Mở Pull Request bằng API (không cần `gh` CLI):
  ```bash
  curl -fsS -X POST \
    -H "Authorization: Bearer $GITHUB_TOKEN" \
    -H "Accept: application/vnd.github+json" \
    https://api.github.com/repos/<owner>/<repo>/pulls \
    -d '{"title":"<tiêu đề>","head":"<branch>","base":"main"}'
  ```
- Không bao giờ in token vào log, commit message, hay file trong repo.
  Token chỉ nên nằm trong environment và git config của workspace.

## Tips & Best Practices

1. **Luôn pull trước khi tạo branch mới**
   ```bash
   git checkout develop
   git pull origin develop
   git flow feature start new-feature
   ```

2. **Commit thường xuyên với message rõ ràng**
   ```bash
   git commit -m "feat: add Vietnamese text chunker"
   git commit -m "fix: resolve encoding issue"
   ```

3. **Xóa branch remote sau khi merge**
   ```bash
   git push origin --delete feature/old-feature
   ```

4. **Xem trạng thái hiện tại**
   ```bash
   git flow status
   git branch -a
   ```
