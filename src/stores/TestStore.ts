 get reviewByQuestionId() {
    const items = this.review?.items ?? [];
    return new Map(items.map((it) => [it.questionId!, it]));
  }

  get results(): CheckResult[] {
    const map = this.reviewByQuestionId;

    return this.questions.map((q) => {
      const it = map.get(q.id);
      return {
        earned: it?.earned ?? 0,
        max: it?.maxScore ?? q.score,
      };
    });
  }

  async start(testId: string) {
    this.testId = testId;
    this.loadState = "loading";
    this.loadError = null;

    try {

      const [testRes, questionsRes] = await Promise.all([
        apiClient.testsDetail(testId),
        apiClient.questionList({ testId }),
      ]);

      const test = testRes.data as TestResponse;
      const questionsDto = questionsRes.data ?? [];
      const mappedQuestions = questionsDto.map((q) => mapQuestionDto(q, testId));

      const initial: AnswersMap = {};
      for (const q of mappedQuestions) {
        initial[q.id] = {
          type: q.type,
          value: q.type === "multiple" ? [] : q.type === "text" ? "" : null,
        };
      }

      await this.ensureAttempt();

      runInAction(() => {
        this.test = test;
        this.allQuestions = mappedQuestions;
        this.timeLeftSec = this.durationSec;
        this.answers = initial;
        this.loadState = "ready";
      });

    } catch (e: any) {

      runInAction(() => {
        this.loadError = e?.response?.data?.message || e?.message || "Ошибка загрузки";
        this.loadState = "error";
      });
    }
  }

  async ensureAttempt(): Promise<number> {

    if (this.testId == null) throw new Error("testId отсутствует");
    if (this.attemptId != null) return this.attemptId;

    const pickActiveFromSummary = async (): Promise<number | null> => {
      const summaryRes = await apiClient.studentTestsSummaryList();
      const summary = summaryRes.data as StudentTestSummaryDto[];

      const row = summary?.find((x) => x.testId === this.testId);
      if (!row || !row.hasActiveAttempt) return null;

      const id = row.activeAttemptId ?? null;
      return typeof id === "number" ? id : null;
    };

    const active = await pickActiveFromSummary();
    if (active != null) {
      runInAction(() => {
        this.attemptId = active;
      });
      return active;
    }

    try {
      await apiClient.attemptsCreate({ testId: this.testId });
    } catch (e: any) {
      const status = e?.response?.status;
      if (status !== 400 && status !== 409) throw e;
    }

    const afterCreate = await pickActiveFromSummary();
    if (afterCreate == null) {
      throw new Error("Не удалось получить activeAttemptId после начала попытки");
    }

  
    runInAction(() => {
      this.attemptId = afterCreate;
    });

    return afterCreate;
  }

  async sendAllAnswers() {
    if (this.testId == null) throw new Error("testId отсутствует");

    const attemptId = await this.ensureAttempt();

    for (const q of this.questions) {
      const a = this.answers[q.id];
      if (!a) continue;

      if (a.type === "text") {
        const text = typeof a.value === "string" ? a.value : "";

        await apiClient.studentAnswersCreate({
          attemptId,
          questionId: q.id,
          userTextAnswers: text.trim() === "" ? null : text,
          userSelectedOptions: null,
        });

        continue; 
      }

      if (a.type === "single") {
        const selected = typeof a.value === "number" ? [a.value] : [];

        await apiClient.studentAnswersCreate({
          attemptId,
          questionId: q.id,
          userSelectedOptions: selected,
          userTextAnswers: null,
        });

        continue; 
      }

      const selected = Array.isArray(a.value) ? a.value : [];

      await apiClient.studentAnswersCreate({
        attemptId,
        questionId: q.id,
        userSelectedOptions: selected,
        userTextAnswers: null,
      });
    }
  }

  async finishAttempt() {
    const attemptId = await this.ensureAttempt();
    await apiClient.attemptsUpdate({ id: attemptId });
  }
}

export const testStore = new TestStore();
