## 1. [Tạo token trên GitHub](https://github.com/settings/personal-access-tokens)

**Cách khuyên dùng — Fine-grained PAT:**

1. Vào GitHub → avatar góc phải → **Settings** → cuộn xuống **Developer settings** (dưới cùng menu trái) → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**
2. Điền:
   - **Resource owner**: tài khoản của bạn
   - **Repository access**: chọn **Only select repositories** → tick đúng repo cần push
   - **Permissions** → **Repository permissions**:
     - `Contents: Read and write` — **bắt buộc** để push code
     - `Pull requests: Read and write` — nếu agent mở PR
     - `Metadata: Read-only` — tự động thêm, giữ nguyên
   - **Expiration**: 30/90 ngày hoặc tùy chọn
3. Bấm **Generate token** → copy ngay (chỉ hiện **1 lần**, prefix `github_pat_...`)

**Hoặc classic PAT** (nhanh hơn, ít kiểm soát hơn): *Settings → Developer settings → Tokens (classic) → Generate new token (classic)* → tick scope **`repo`** (hoặc chỉ `public_repo` nếu repo public) → prefix `ghp_...`.

## 2. Dán vào `.env`

`.env` của bạn đã có sẵn dòng (dòng 21), chỉ cần điền:

```
GITHUB_TOKEN=github_pat_xxx...
```

`.env` đã nằm trong `.gitignore` nên sẽ không bị commit — an toàn.

## 3. Áp dụng

Compose chỉ đọc `.env` lúc chạy lệnh `up`, nên phải recreate container để biến mới có hiệu lực:

```powershell
docker compose up -d --force-recreate orchestrator
```

Kiểm tra token đã vào container:

```powershell
docker compose exec orchestrator sh -c 'test -n "$GITHUB_TOKEN" && echo "token OK"'
```

## ⚠️ Lưu ý quan trọng với setup hiện tại (đã soi mã nguồn)

- `docker-compose.yml` (dòng 96) chỉ truyền `GITHUB_TOKEN` vào service **`orchestrator`**. Các container agent (`dsh-pm`, `dsh-backend`, ...) — nơi thực sự chạy `git push` — **không nhận biến này**, nên kể cả khi có token trong `.env`, agent vẫn push fail vì thiếu credential.
- Workspaces hiện chưa có repo git nào (chưa có `.git`, chưa có remote), nên agent cũng chưa có remote để push.

Để agent thực sự push được cần thêm 1 trong 2:
1. **Thêm `GITHUB_TOKEN` vào env các service agent** trong `docker-compose.yml` (thêm dòng `GITHUB_TOKEN: ${GITHUB_TOKEN:-}` vào `environment` của từng service `dsh-*`), và
2. **Cấu hình remote nhúng token** trong workspace, ví dụ: `git remote add origin https://x-access-token:<TOKEN>@github.com/<owner>/<repo>.git` (agent tự làm theo hướng dẫn trong `agents/skills/git-branching/SKILL.md`), hoặc dùng `gh auth login` với `GH_TOKEN`.

Nếu bạn muốn, tôi có thể sửa `docker-compose.yml` để đưa `GITHUB_TOKEN` vào tất cả container agent (kèm comment cảnh báo bảo mật như README đã ghi là chỉ nên dùng cho prototype). Bạn có muốn tôi làm luôn không?
