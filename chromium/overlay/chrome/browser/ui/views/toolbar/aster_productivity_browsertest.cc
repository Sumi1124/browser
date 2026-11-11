// Copyright 2026 Aster contributors. BSD-3-Clause; see //aster/LICENSE.
#include "base/functional/bind.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/ui/browser.h"
#include "chrome/browser/ui/tabs/tab_strip_model.h"
#include "chrome/browser/ui/views/toolbar/aster_productivity.h"
#include "chrome/test/base/in_process_browser_test.h"
#include "content/public/browser/web_contents.h"
#include "content/public/test/browser_test.h"
#include "content/public/test/browser_test_utils.h"
#include "content/public/test/url_loader_interceptor.h"
#include "testing/gtest/include/gtest/gtest.h"

class AsterSplitSearchBrowserTest : public InProcessBrowserTest {
 protected:
  aster::SplitSearchRequest Request() {
    aster::SplitSearchRequest request;
    request.query = "Causes of the Great Depression";
    request.left = {"left", "Left", "https://left.aster.test/search?q={query}"};
    request.right = {"right", "Right",
                     "https://right.aster.test/search?q={query}"};
    return request;
  }
  void SetUpOnMainThread() override {
    interceptor_ =
        std::make_unique<content::URLLoaderInterceptor>(base::BindRepeating(
            [](content::URLLoaderInterceptor::RequestParams* params) {
              if (!params->url_request.url.DomainIs("aster.test"))
                return false;
              content::URLLoaderInterceptor::WriteResponse(
                  "HTTP/1.1 200 OK\nContent-Type: text/html\n\n",
                  "<!doctype html><title>Local search "
                  "fixture</title><p>Independent page</p>",
                  params->client.get());
              return true;
            }));
  }
  void TearDownOnMainThread() override { interceptor_.reset(); }

 private:
  std::unique_ptr<content::URLLoaderInterceptor> interceptor_;
};
IN_PROC_BROWSER_TEST_F(AsterSplitSearchBrowserTest,
                       CreatesIndependentChromiumTabs) {
  auto* model = browser()->GetTabStripModel();
  const int before = model->count();
  ASSERT_TRUE(aster::RunSplitSearch(browser(), Request()));
  ASSERT_EQ(before + 2, model->count());
  auto* left = model->GetWebContentsAt(before);
  auto* right = model->GetWebContentsAt(before + 1);
  ASSERT_TRUE(content::WaitForLoadStop(left));
  ASSERT_TRUE(content::WaitForLoadStop(right));
  EXPECT_NE(left, right);
  EXPECT_EQ(left->GetBrowserContext(), browser()->GetProfile());
  EXPECT_EQ(model->GetSplitForTab(before), model->GetSplitForTab(before + 1));
  EXPECT_TRUE(model->GetSplitForTab(before).has_value());
  EXPECT_EQ(left->GetLastCommittedURL().host(), "left.aster.test");
  EXPECT_EQ(right->GetLastCommittedURL().query(),
            "q=Causes%20of%20the%20Great%20Depression");
}
IN_PROC_BROWSER_TEST_F(AsterSplitSearchBrowserTest,
                       UnsynchronizedSearchOnlyNavigatesActivePane) {
  auto request = Request();
  ASSERT_TRUE(aster::RunSplitSearch(browser(), request));
  auto* model = browser()->GetTabStripModel();
  auto* left = model->GetWebContentsAt(model->count() - 2);
  auto* right = model->GetWebContentsAt(model->count() - 1);
  ASSERT_TRUE(content::WaitForLoadStop(left));
  ASSERT_TRUE(content::WaitForLoadStop(right));
  auto right_url = right->GetLastCommittedURL();
  const int count = model->count();
  request.query = "second query";
  request.synchronize = false;
  ASSERT_TRUE(aster::RunSplitSearch(browser(), request));
  ASSERT_TRUE(content::WaitForLoadStop(left));
  EXPECT_EQ(left->GetLastCommittedURL().query(), "q=second%20query");
  EXPECT_EQ(right->GetLastCommittedURL(), right_url);
  EXPECT_EQ(model->count(), count);
}
IN_PROC_BROWSER_TEST_F(AsterSplitSearchBrowserTest,
                       InvalidProviderDoesNotOpenTabs) {
  auto request = Request();
  request.right.url_template = "javascript:alert('{query}')";
  int count = browser()->GetTabStripModel()->count();
  EXPECT_FALSE(aster::RunSplitSearch(browser(), request));
  EXPECT_EQ(browser()->GetTabStripModel()->count(), count);
}
IN_PROC_BROWSER_TEST_F(AsterSplitSearchBrowserTest,
                       ReusesCurrentTabAndKeepsPrivateProfile) {
  Browser* private_browser = CreateIncognitoBrowser();
  auto* model = private_browser->GetTabStripModel();
  auto* original = model->GetActiveWebContents();
  const int count = model->count();
  auto request = Request();
  request.reuse_current_tab = true;
  ASSERT_TRUE(aster::RunSplitSearch(private_browser, request));
  ASSERT_EQ(model->count(), count + 1);
  EXPECT_EQ(model->GetActiveWebContents(), original);
  for (int i = 0; i < model->count(); ++i)
    EXPECT_EQ(model->GetWebContentsAt(i)->GetBrowserContext(),
              private_browser->GetProfile());
  EXPECT_TRUE(private_browser->GetProfile()->IsOffTheRecord());
}
