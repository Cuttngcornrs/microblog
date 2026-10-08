# Microblog — GitHub Pages + Supabase

A tiny personal microblog that behaves like a real database-backed site while the frontend remains a normal static GitHub Pages site.

## What it does

- Public feed: anyone can read posts.
- Owner-only publishing and post deletion.
- Email/password accounts for commenters.
- Public comments on each post.
- Users can delete their own comments.
- The owner can delete any comment.
- Supabase Row Level Security enforces permissions in the database.
- No HTML editing is needed when you publish a new post.

## 1. Create the database

1. Create a project at Supabase.
2. Open **SQL Editor**.
3. Paste the full contents of `supabase.sql` and run it.
4. Create your normal account through the finished site, or create it in Supabase Auth.
5. In SQL Editor, make your account the owner by replacing the email below and running:

```sql
update public.profiles p
set role = 'owner'
from auth.users u
where p.id = u.id
  and u.email = 'YOUR_EMAIL@example.com';
```

## 2. Configure the frontend

Copy:

```text
config.example.js -> config.js
```

Put your Supabase **Project URL** and browser-safe **anon/publishable key** into `config.js`.

Do **not** put a `service_role` / secret key in the browser.

## 3. Deploy to GitHub Pages

Put these files in a GitHub repository. Then enable GitHub Pages from the repository's Pages settings and publish the branch/folder containing `index.html`.

No server is required on GitHub Pages; the browser talks directly to Supabase for authentication and database operations.

## 4. Supabase Auth settings

For email signup, set your GitHub Pages URL as an allowed redirect/site URL in Supabase Auth. The site can then use normal email/password sign-in and signup.

## Notes

The public Supabase URL and browser-safe publishable/anon key are expected to be present in the frontend. The security boundary is Supabase Auth + Postgres RLS, not hiding the browser key.
