// Copyright 2026 Aster contributors. BSD-3-Clause; see LICENSE.
#include <algorithm>
#include <cstdlib>
#include <functional>
#include <iostream>
#include <limits>
#include <random>
#include <string>
#include <utility>
#include <vector>
#include "aster/core/search.h"
#include "aster/core/workspace.h"
namespace {
int checks = 0;
#define EXPECT(condition)                                               \
  do {                                                                  \
    ++checks;                                                           \
    if (!(condition)) {                                                 \
      std::cerr << __FILE__ << ':' << __LINE__ << ": " #condition "\n"; \
      std::exit(1);                                                     \
    }                                                                   \
  } while (false)
using Case = std::pair<const char*, std::function<void()>>;
}  // namespace
int main() {
  using namespace aster;
  const std::vector<Case> cases = {
      {"six providers and safe percent encoding",
       [] {
         EXPECT(BuiltinProviders().size() == 6);
         for (const auto& provider : BuiltinProviders()) {
           EXPECT(IsValidSearchTemplate(provider.url_template));
           auto url = SearchUrl(provider, "great depression & 100% #?+ / 日本");
           EXPECT(url &&
                  url->find("great%20depression%20%26%20100%25%20%23%3F%2B%20%"
                            "2F%20%E6%97%A5%E6%9C%AC") != std::string::npos);
           EXPECT(url->find('{') == std::string::npos);
         }
       }},
      {"custom provider rejects executable or malformed templates",
       [] {
         for (const auto& url :
              {"javascript:alert('{query}')", "http://example.com/?q={query}",
               "https://{query}.example.com/",
               "https://user:pass@example.com/?q={query}",
               "https://example.com/?q={query}&x={query}",
               "https://example.com/?q={query}#fragment",
               "https://example.com/?q={query}&x={x}",
               "https://example.com/?q=no-placeholder",
               "https://example.com\\evil/?q={query}",
               "https://example.com:0/?q={query}",
               "https://example.com:999999/?q={query}",
               "https://-bad.example/?q={query}",
               "https://bad..example/?q={query}",
               "https://example.com/\n?q={query}"})
           EXPECT(!IsValidSearchTemplate(url));
         EXPECT(IsValidSearchTemplate(
             "https://search.example:8443/find/{query}?language=en"));
       }},
      {"UTF-8 and query size validation",
       [] {
         for (const std::string& query :
              {std::string(), std::string("   "), std::string("\xC0\xAF"),
               std::string("\xED\xA0\x80"), std::string("\xF4\x90\x80\x80"),
               std::string("\xE3\x81"), std::string("a\0b", 3),
               std::string(4097, 'x'), std::string("a\nb")})
           EXPECT(!SearchUrl(BuiltinProviders()[0], query));
         EXPECT(SearchUrl(BuiltinProviders()[0], std::string(4096, 'x')));
         EXPECT(IsValidUtf8("🧠 日本 العربية"));
       }},
      {"dual query defaults and isolated navigation",
       [] {
         SplitSession split;
         auto moves = split.Search("Causes of the Great Depression", 0);
         EXPECT(moves && moves->size() == 2);
         EXPECT((*moves)[0].url ==
                "https://www.google.com/"
                "search?q=Causes%20of%20the%20Great%20Depression");
         EXPECT((*moves)[1].url.starts_with("https://duckduckgo.com/"));
         const auto left = split.panes()[0].url;
         split.SetSynchronized(false);
         moves = split.Search("independent", 1);
         EXPECT(moves && moves->size() == 1 && moves->front().pane_id == 2);
         EXPECT(split.panes()[0].url == left);
       }},
      {"failed operations leave split state intact",
       [] {
         SplitSession split;
         EXPECT(split.Search("valid", 0));
         auto first = split.panes()[0].url;
         EXPECT(!split.Search("", 0));
         EXPECT(!split.Search("query", 2));
         EXPECT(!split.SetProvider(0, {"bad", "Bad", "file://{query}"}));
         EXPECT(!split.SetProvider(99, BuiltinProviders()[0]));
         EXPECT(!split.AdoptTab(0, "javascript:alert(1)"));
         EXPECT(split.panes()[0].url == first);
       }},
      {"pane identities survive reorder and close",
       [] {
         SplitSession split;
         EXPECT(split.AdoptTab(0, "https://example.org/paper"));
         EXPECT(split.Swap(0, 1));
         EXPECT(split.panes()[1].id == 1 &&
                split.panes()[1].url == "https://example.org/paper");
         EXPECT(!split.Swap(0, 7));
         EXPECT(split.Close(0));
         EXPECT(split.panes().size() == 1 && split.panes()[0].id == 1);
         EXPECT(!split.Close(0));
       }},
      {"layout changes never silently discard pages",
       [] {
         SplitSession split;
         EXPECT(split.SetLayout(SplitLayout::kGrid));
         EXPECT(split.panes().size() == 4);
         EXPECT(!split.SetLayout(SplitLayout::kColumns));
         EXPECT(!split.SetLayout(static_cast<SplitLayout>(999)));
         EXPECT(split.Close(3));
         EXPECT(split.layout() == SplitLayout::kThreeColumns);
         EXPECT(split.Close(2));
         EXPECT(split.SetLayout(SplitLayout::kRows));
         EXPECT(split.Search("query", 0)->size() == 2);
       }},
      {"divider clamping and geometry",
       [] {
         SplitSession split;
         EXPECT(!split.Resize(std::numeric_limits<double>::quiet_NaN()));
         EXPECT(!split.Resize(std::numeric_limits<double>::infinity()));
         EXPECT(split.Resize(-8) && split.ratio() == .15);
         EXPECT(split.Resize(8) && split.ratio() == .85);
         EXPECT(split.Resize(.5));
         auto bounds = split.Bounds(1000, 600, 8);
         EXPECT((bounds[0] == PaneRect{0, 0, 496, 600}));
         EXPECT((bounds[1] == PaneRect{504, 0, 496, 600}));
         EXPECT(split.SetLayout(SplitLayout::kRows));
         bounds = split.Bounds(1000, 600, 8);
         EXPECT((bounds[1] == PaneRect{0, 304, 1000, 296}));
       }},
      {"geometry stays bounded at narrow and zero sizes",
       [] {
         for (auto layout : {SplitLayout::kColumns, SplitLayout::kRows,
                             SplitLayout::kThreeColumns, SplitLayout::kGrid}) {
           SplitSession split;
           EXPECT(split.SetLayout(layout));
           for (int w : {0, 1, 3, 5, 8, 1024})
             for (int h : {0, 1, 3, 768}) {
               auto bounds = split.Bounds(w, h, 17);
               EXPECT(bounds.size() == split.panes().size());
               for (const auto& b : bounds)
                 EXPECT(b.x >= 0 && b.y >= 0 && b.width >= 0 && b.height >= 0 &&
                        b.x <= w && b.width <= w - b.x && b.y <= h &&
                        b.height <= h - b.y);
             }
         }
       }},
      {"default workspaces, stable IDs, and custom validation",
       [] {
         auto catalog = DefaultWorkspaces();
         EXPECT(catalog.workspaces.size() == 5 && ValidateCatalog(catalog));
         EXPECT(catalog.workspaces[2].name == "IB MYP");
         EXPECT(catalog.workspaces[3].name == "IB Diploma Programme");
         EXPECT(AddWorkspace(catalog, "fieldwork", "Fieldwork 日本"));
         const auto before = catalog;
         EXPECT(!AddWorkspace(catalog, "fieldwork", "Duplicate"));
         EXPECT(!AddWorkspace(catalog, "../profile", "Traversal"));
         EXPECT(!AddWorkspace(catalog, "valid", ""));
         EXPECT(catalog == before);
       }},
      {"saved sessions retain active tab, group, and pin state",
       [] {
         auto catalog = DefaultWorkspaces();
         SavedSession session{
             "Literature",
             {{"https://example.org/a", "First", "History", true},
              {"https://example.org/b", "Second", "History", false}},
             1};
         EXPECT(SaveSession(catalog, "ib-dp", session));
         EXPECT(catalog.workspaces[3].sessions.front() == session);
         session.tabs[0].title = "Updated";
         EXPECT(SaveSession(catalog, "ib-dp", session));
         EXPECT(catalog.workspaces[3].sessions.size() == 1);
         auto before = catalog;
         session.active_tab = 4;
         EXPECT(!SaveSession(catalog, "ib-dp", session));
         EXPECT(!SaveSession(catalog, "missing", session));
         EXPECT(catalog == before);
       }},
      {"bookmark folders deduplicate exact URLs within a workspace",
       [] {
         auto catalog = DefaultWorkspaces();
         EXPECT(AddBookmark(catalog, "research",
                            {"https://example.org/", "A", "Economics"}));
         EXPECT(AddBookmark(catalog, "research",
                            {"https://example.org/", "B", "Economics"}));
         EXPECT(catalog.workspaces[4].bookmarks.size() == 1);
         EXPECT(catalog.workspaces[4].bookmarks[0].title == "B");
         EXPECT(AddBookmark(catalog, "research",
                            {"https://example.org/", "B", "History"}));
         EXPECT(catalog.workspaces[4].bookmarks.size() == 2);
         EXPECT(catalog.workspaces[0].bookmarks.empty());
       }},
      {"session restore rejects privileged or credential-bearing URLs",
       [] {
         for (const auto& url :
              {"javascript:alert(1)", "data:text/html,hi", "file:///etc/passwd",
               "chrome://settings/", "https://user:pass@example.org/",
               "https://example.org/\n"})
           EXPECT(!IsRestorableUrl(url));
         EXPECT(IsRestorableUrl("https://example.org/paper#section"));
         EXPECT(IsRestorableUrl("http://localhost:8000/paper"));
         EXPECT(IsRestorableUrl("about:blank"));
         auto catalog = DefaultWorkspaces();
         EXPECT(
             !SaveSession(catalog, "personal",
                          {"Bad", {{"data:text/html,x", "", "", false}}, 0}));
       }},
      {"private catalogs cannot be persisted",
       [] {
         auto catalog = DefaultWorkspaces();
         EXPECT(!EncodeCatalog(catalog, true));
         EXPECT(EncodeCatalog(catalog, false));
       }},
      {"catalog round trip preserves Unicode and every field",
       [] {
         auto catalog = DefaultWorkspaces();
         EXPECT(SaveSession(
             catalog, "research",
             {"日本",
              {{"https://example.org/", "Résumé 🧠", "Theory", true}},
              0}));
         EXPECT(AddBookmark(catalog, "research",
                            {"https://example.org/data", "Data", "Evidence"}));
         catalog.active_id = "research";
         auto encoded = EncodeCatalog(catalog, false);
         EXPECT(encoded);
         auto decoded = DecodeCatalog(*encoded);
         EXPECT(decoded && *decoded == catalog);
         EXPECT(EncodeCatalog(*decoded, false) == encoded);
       }},
      {"truncation, trailing bytes, unknown version, and count bombs rejected",
       [] {
         auto encoded = *EncodeCatalog(DefaultWorkspaces(), false);
         for (std::size_t i = 0; i < encoded.size(); ++i)
           EXPECT(!DecodeCatalog(encoded.substr(0, i)));
         EXPECT(!DecodeCatalog(encoded + "trailing"));
         encoded[7] = '2';
         EXPECT(!DecodeCatalog(encoded));
         EXPECT(!DecodeCatalog("ASTERWS1\xff\xff\xff\x7f"));
         EXPECT(!DecodeCatalog(std::string(4 * 1024 * 1024 + 1, 'A')));
       }},
      {"catalog limits and referential integrity",
       [] {
         auto catalog = DefaultWorkspaces();
         catalog.active_id = "nonexistent";
         EXPECT(!ValidateCatalog(catalog));
         catalog = DefaultWorkspaces();
         catalog.workspaces[1].id = catalog.workspaces[0].id;
         EXPECT(!ValidateCatalog(catalog));
         catalog = DefaultWorkspaces();
         SavedSession huge{"Huge",
                           std::vector<SavedTab>(
                               257, {"https://example.org/", "", "", false}),
                           0};
         EXPECT(!SaveSession(catalog, "personal", huge));
         for (int i = 0; i < 16; ++i)
           EXPECT(SaveSession(catalog, "personal", {std::to_string(i), {}, 0}));
         EXPECT(!SaveSession(catalog, "personal", {"overflow", {}, 0}));
       }},
      {"20,000 deterministic corrupted inputs stay bounded and validated",
       [] {
         std::mt19937 rng(71517);
         const auto good = *EncodeCatalog(DefaultWorkspaces(), false);
         for (int i = 0; i < 20000; ++i) {
           std::string input = (i % 2) ? good : std::string(rng() % 700, 'a');
           for (unsigned j = 0, count = rng() % 12; j < count && !input.empty();
                ++j)
             input[rng() % input.size()] = static_cast<char>(rng() & 255);
           auto result = DecodeCatalog(input);
           if (result) {
             EXPECT(ValidateCatalog(*result));
             EXPECT(DecodeCatalog(*EncodeCatalog(*result, false)) == result);
           }
         }
       }},
  };
  for (const auto& [name, run] : cases) {
    run();
    std::cout << "PASS " << name << '\n';
  }
  std::cout << cases.size() << " cases, " << checks << " assertions passed\n";
}
