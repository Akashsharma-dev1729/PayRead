-- Existing deployments: run this entire file in Supabase SQL Editor.
-- Keeps the earliest published non-seed article paid, makes other published
-- articles free, and adds five free reads. Existing payment records are untouched.
begin;
alter table public.articles drop constraint if exists articles_price_paise_check;
alter table public.articles add constraint articles_price_paise_check check (price_paise >= 0);

create or replace function public.get_article_content(
  p_article_id uuid,
  p_access_token uuid
)
returns table (
  id uuid,
  title text,
  excerpt text,
  content text,
  price_paise integer,
  published boolean,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.title, a.excerpt, a.content, a.price_paise, a.published, a.created_at
  from public.articles a
  where a.id = p_article_id
    and a.published = true
    and (a.price_paise = 0 or exists (
      select 1
      from public.payments p
      where p.article_id = a.id
        and p.access_token = p_access_token
        and p.status = 'completed'
    ))
  limit 1;
$$;
revoke execute on function public.get_article_content(uuid, uuid) from public;
grant execute on function public.get_article_content(uuid, uuid) to anon, authenticated;

insert into public.articles(id, title, excerpt, content, price_paise, published) values
('71000000-0000-4000-8000-000000000001', 'A Small Reading Habit That Fits a Busy Day', 'Make room for reading without turning it into another chore.', 'A reading habit does not have to begin with a large target. Start with a moment that already exists in your day: the ten minutes after lunch, a quiet commute, or the time before you put your phone away at night. Choose one short article and give it your full attention.

Make starting easy. Keep your next read somewhere you can find it, close unrelated tabs, and silence notifications for a few minutes. You do not need to finish every piece you begin. If it does not answer your question or hold your interest, choose something else.

After reading, write one sentence about what stayed with you. It might be a useful idea, an unanswered question, or a point you disagree with. This turns reading from collecting information into thinking about it.

On busy days, read a paragraph. On quieter days, stay longer. The useful habit is returning to reading, not protecting a perfect streak.', 0, true),
('71000000-0000-4000-8000-000000000002', 'How to Check an Online Claim', 'A practical pause before trusting or sharing information.', 'An impressive headline is an invitation to investigate, not a reason to believe. Before sharing a claim, open the full article and identify exactly what it says. A prediction, an opinion, and a measured result are different kinds of statements.

Look for the original source. If an article mentions a study or announcement, follow the link and check the date. Ask whether the source actually supports the headline. A small study about one group cannot automatically describe everyone, and an old announcement may no longer reflect the situation.

Separate evidence from repetition. Several websites repeating the same sentence may all rely on one unsupported post. Independent confirmation is more useful than a large number of copies.

When you cannot verify something, it is fine to leave it unresolved. You can save the link, ask what evidence would change your mind, and return later. Saying that you do not know is often more accurate than choosing the most confident explanation.', 0, true),
('71000000-0000-4000-8000-000000000003', 'Plan Your Week with Three Priorities', 'A simple way to give important work some space.', 'Begin a weekly plan by listing your fixed commitments. Classes, work hours, appointments, and travel already occupy time. Planning around them is more useful than pretending every hour is available.

Next, choose three outcomes that would make the week worthwhile. Keep them concrete: finish a draft, repair one bug, or prepare a short presentation. Break each outcome into a first action small enough to begin without another planning session.

Leave some space unassigned. Tasks take longer than expected, people need help, and your energy changes. A plan with no room to move is difficult to maintain. If you miss a task, move it deliberately instead of copying a growing backlog into every day.

At the end of the week, review what helped and what got in the way. Keep the parts that worked. Your plan is a tool for making decisions, and it should change when your circumstances do.', 0, true),
('71000000-0000-4000-8000-000000000004', 'Better Notes Begin with Better Questions', 'Capture ideas you can understand and use later.', 'Copying every sentence can produce long notes without much understanding. Before a lesson, meeting, or article, write down the question you want it to answer. That question gives your notes a purpose.

As you listen or read, capture the main idea in your own words. Add one example and record any condition that limits the claim. For a technical concept, a small input and output can be more useful than a page of definitions.

Keep unanswered questions visible. Mark the point where your understanding breaks down instead of hiding it inside a polished summary. Later, try answering that question without looking at the source. If you cannot, revisit the relevant section.

Finish with a short next step: test an example, explain the idea aloud, or use it in a small task. Useful notes help you do something with an idea. They do not need to look impressive to anyone else.', 0, true),
('71000000-0000-4000-8000-000000000005', 'Build a Small Project You Can Finish', 'Reduce scope while keeping a complete, useful experience.', 'A small project becomes manageable when it solves one clear problem. Describe who will use it and what they should be able to finish. For a notes app, that might be creating a note, saving it, and finding it again after reopening the page.

Build that complete path before adding optional features. A theme switcher can wait if saving does not work. Use simple tools you understand, and keep a short list of decisions so that you can explain the project later.

Test the ordinary path and a few likely failures. Try an empty input, refresh the page, and check what happens when a request fails. A useful error message is part of the experience, not a finishing decoration.

Once the core path works, write down how to run the project and what it cannot yet do. Finishing a modest project gives you something to learn from. You can expand it later with evidence from actual use.', 0, true)
on conflict (id) do nothing;

do $$
declare paid_id uuid;
begin
  select id into paid_id from public.articles
  where published = true and id not in ('71000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000002', '71000000-0000-4000-8000-000000000003', '71000000-0000-4000-8000-000000000004', '71000000-0000-4000-8000-000000000005')
  order by created_at, id limit 1;
  if paid_id is null then
    paid_id := '71000000-0000-4000-8000-000000000100';
    insert into public.articles(id,title,excerpt,content,price_paise,published)
    values (paid_id, 'From Idea to Finished Project',
      'A practical guide to defining, building, checking, and finishing a useful small project.',
      'Start by describing one person and one task your project will help them complete. Write down how you will know that task has succeeded. This gives you a concrete goal against which to judge every feature.

Build the smallest complete path first. Connect the input, processing, storage, and result before polishing the screen. Keep changes small enough that you can explain them, and save a working checkpoint before adding complexity.

Test with realistic examples and deliberately incomplete inputs. Check what happens after a refresh, a failed request, or a second click. Record what you actually tested and what remains uncertain. A successful build is useful evidence, but it does not prove every interaction works.

Prepare the project for someone else. Include setup instructions, required configuration names, and a short explanation of its limitations. Remove unused experiments and make error messages understandable.

Finally, decide what finished means for this version. Deliver the useful core, collect feedback, and choose the next improvement from a real need. A finished project can still evolve; it simply has a clear, working promise today.',
      10000,true)
    on conflict (id) do update set price_paise=10000,published=true;
  end if;
  update public.articles set price_paise = case when id = paid_id then 10000 else 0 end
  where published = true;
end $$;
notify pgrst, 'reload schema';
commit;
