# Website Development Onboarding v2

Client-facing intake questionnaire for generating high-quality design-research prompts and Perplexity research reports.

This version merges the original `Website Development Onboarding` form with the strongest strategic questions from the later dev questionnaire.

## Page 1: Business And Project Basics

1. What is your business name as it should appear publicly?
2. What is your first name?
3. What is your last name?
4. What is your email address?
5. What is your phone number?
6. In 2-3 sentences, what does your business do, who do you serve, and where do you operate?
7. What industry are you in? Include the most relevant sub-category.
8. Are you the primary contact for this project?
9. What is the project start date?
10. What is the main goal of this website? List priorities in order if there are several.
11. Is this a new site, a redesign, or a full overhaul?
12. What cities, regions, or provinces do you serve?
13. Are your clients businesses, consumers, or both?
14. Who specifically do you work with? List job titles, company types, or customer types.

## Page 2: Website Setup And Brand Direction

15. Do you already have a domain name registered?
16. List all current domains and subdomains you own.
17. Do you already have hosting?
18. What is your current website URL, if any?
19. What pages do you want on the site?
20. Do you have existing branding guidelines or a style guide?
21. What colour palette do you want to use? Include hex codes if you have them.
22. List 2-4 websites you like for inspiration, and explain what you like about each.
23. Which visual style feels closest to what you want?
24. Upload your logo if you have one.
25. Upload your brand guide if you have one.

## Page 3: Positioning And Trust

26. What are your top 5-10 services or products, in order of importance?
27. What high-stakes problems or urgent situations usually cause clients to contact you?
28. When clients compare you to competitors, what top 3 factors matter most?
29. What makes your business different from competitors?
30. If you had 30 seconds to explain why someone should hire you over a competitor, what would you say?
31. Do you have niche skills, certifications, or specialized experience others do not?
32. List licenses, insurance limits, bonding, safety certifications, and industry memberships.
33. Who are your main competitors? Include URLs if possible.
34. List 3-5 major projects or recognizable clients we can reference.
35. Do you have testimonials or references we can use? Include name, title, company, and quote if available.

## Page 4: Content, SEO, And Operations

36. What social media networks are you on? Include links.
37. Is your content ready, partially ready, or do you need help creating it?
38. Do you have high-quality photos of your team, fleet, projects, or worksites?
39. If not, are you willing to schedule a photoshoot?
40. Beyond your main services, what specific services need their own SEO landing pages?
41. What would your ideal client type into Google to find you?
42. Do you need SEO setup?
43. Do you need ongoing maintenance and support after launch?
44. Do you use any CRM, field service, booking, or quoting software that the website should integrate with?
45. What questions does your office answer repeatedly about services, billing, compliance, or process?
46. Will the site need multiple language versions?
47. What is your desired launch date?
48. Which additional features do you need on the website?

## Suggested Field Types

- Questions 1-5: short text fields
- Questions 8, 13, 15, 17, 20, 37, 39, 42, 43, 46: single-choice fields
- Questions 9 and 47: date fields
- Questions 24 and 25: file upload fields
- Questions 23, 38, and 48: single-choice or multi-select fields
- All other questions: long text fields

## Internal Only

These should not be client-facing form fields:

- `CLIENT_CONTEXT_BLURB`
- `CLIENT_TYPE_LABEL`

These should be added or derived internally after intake review.
