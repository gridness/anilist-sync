const ENDPOINT = "https://graphql.anilist.co";

const ENTRY_FIELDS = `
  id
  status
  progress
  startedAt { year month day }
  completedAt { year month day }
`;

const UNOWNED_ENTRY_FIELDS = `
  score
  progressVolumes
  repeat
  priority
  private
  notes
  hiddenFromStatusLists
  customLists
  advancedScores
`;

const MEDIA_FIELDS = `
  id
  episodes
  format
  season
  seasonYear
  title { userPreferred romaji english native }
  synonyms
`;

function createAniList(http) {
  async function request(query, variables = {}, token = "") {
    const headers = { "Content-Type": "application/json", Accept: "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;

    let response;
    try {
      response = await http.post(ENDPOINT, { headers, params: {}, data: { query, variables } });
    } catch (error) {
      const wrapped = new Error(error?.reason || error?.message || "AniList request failed");
      wrapped.status = error?.statusCode || 0;
      throw wrapped;
    }

    let body = response.data;
    if (!body && response.text) {
      try {
        body = JSON.parse(response.text);
      } catch (_) {
        throw new Error("AniList returned an unreadable response");
      }
    }
    if (response.statusCode >= 400 || body?.errors?.length) {
      const error = new Error(body?.errors?.[0]?.message || response.reason || "AniList request failed");
      error.status = response.statusCode;
      throw error;
    }
    return body?.data;
  }

  async function viewer(token) {
    return (await request(`query { Viewer { id name } }`, {}, token)).Viewer;
  }

  async function search(searchText, token = "") {
    const entry = token ? `mediaListEntry { ${ENTRY_FIELDS} }` : "";
    const data = await request(
      `query ($search: String) {
        Page(page: 1, perPage: 10) {
          media(type: ANIME, search: $search, sort: SEARCH_MATCH) {
            ${MEDIA_FIELDS}
            ${entry}
          }
        }
      }`,
      { search: searchText },
      token,
    );
    return data.Page.media;
  }

  async function media(mediaId, token) {
    const data = await request(
      `query ($id: Int) {
        Media(id: $id, type: ANIME) {
          ${MEDIA_FIELDS}
          mediaListEntry { ${ENTRY_FIELDS} ${UNOWNED_ENTRY_FIELDS} }
        }
      }`,
      { id: mediaId },
      token,
    );
    if (!data.Media) throw new Error("AniList title not found");
    return data.Media;
  }

  async function save(mediaId, changes, token) {
    const variables = { mediaId, ...changes };
    for (const key of ["startedAt", "completedAt"]) {
      if (key in changes && changes[key] === null) {
        variables[key] = { year: null, month: null, day: null };
      }
    }
    const data = await request(
      `mutation (
        $mediaId: Int,
        $status: MediaListStatus,
        $progress: Int,
        $startedAt: FuzzyDateInput,
        $completedAt: FuzzyDateInput
      ) {
        SaveMediaListEntry(
          mediaId: $mediaId,
          status: $status,
          progress: $progress,
          startedAt: $startedAt,
          completedAt: $completedAt
        ) { ${ENTRY_FIELDS} }
      }`,
      variables,
      token,
    );
    return data.SaveMediaListEntry;
  }

  async function remove(entryId, token) {
    const data = await request(
      `mutation ($id: Int) { DeleteMediaListEntry(id: $id) { deleted } }`,
      { id: entryId },
      token,
    );
    if (data.DeleteMediaListEntry?.deleted !== true) throw new Error("AniList did not remove the old entry");
    return true;
  }

  return { media, remove, save, search, viewer };
}

module.exports = { createAniList };
