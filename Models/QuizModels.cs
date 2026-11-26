using System.Text.Json.Serialization;

namespace MindQuest.Models;

public sealed class QuizQuestion
{
    public int Id { get; set; }
    public string Difficulty { get; set; } = "medium";
    public string Category { get; set; } = "space";
    public string CategoryLabel { get; set; } = "";
    public string BgTheme { get; set; } = "space";
    public string BgImageKey { get; set; } = "space";
    public string MotifLabel { get; set; } = "";
    public string Question { get; set; } = "";
    public string[] Options { get; set; } = [];
    public int CorrectIndex { get; set; }
    public string Explanation { get; set; } = "";
}

public sealed class PlayerInfo
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Avatar { get; set; } = "🧠";
    public string Color { get; set; } = "#4f46e5";
    public bool IsHost { get; set; }
    public bool IsReady { get; set; }
    public bool Connected { get; set; }
    public int Score { get; set; }
    public int Streak { get; set; }
    public int MaxStreak { get; set; }
    public int CorrectCount { get; set; }
    public int WrongCount { get; set; }
    public int TimeoutCount { get; set; }
    public bool HasAnsweredCurrent { get; set; }
    public int LastEarnedScore { get; set; }
    public int? LastAnswerIndex { get; set; }
    public bool? LastAnswerCorrect { get; set; }
    public long? LastAnswerElapsedMs { get; set; }
    public bool IsEliminated { get; set; }
    public int? EliminatedRound { get; set; }
    public int Rank { get; set; }
    public int PreviousRank { get; set; }

    public PlayerInfo Clone() => new()
    {
        Id = Id,
        Name = Name,
        Avatar = Avatar,
        Color = Color,
        IsHost = IsHost,
        IsReady = IsReady,
        Connected = Connected,
        Score = Score,
        Streak = Streak,
        MaxStreak = MaxStreak,
        CorrectCount = CorrectCount,
        WrongCount = WrongCount,
        TimeoutCount = TimeoutCount,
        HasAnsweredCurrent = HasAnsweredCurrent,
        LastEarnedScore = LastEarnedScore,
        LastAnswerIndex = LastAnswerIndex,
        LastAnswerCorrect = LastAnswerCorrect,
        LastAnswerElapsedMs = LastAnswerElapsedMs,
        IsEliminated = IsEliminated,
        EliminatedRound = EliminatedRound,
        Rank = Rank,
        PreviousRank = PreviousRank
    };
}

public sealed class PublicQuestionPayload
{
    public int Id { get; set; }
    public string Difficulty { get; set; } = "medium";
    public string CategoryLabel { get; set; } = "";
    public string BgTheme { get; set; } = "space";
    public string BgImageKey { get; set; } = "space";
    public string MotifLabel { get; set; } = "";
    public string Question { get; set; } = "";
    public string[] Options { get; set; } = [];
}

public sealed class EliminatedSummary
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Avatar { get; set; } = "🧠";
    public int Score { get; set; }
    public int Round { get; set; }
}

public sealed class RoomRevealPayload
{
    public int CorrectIndex { get; set; }
    public string Explanation { get; set; } = "";
    public List<PlayerInfo> Standings { get; set; } = [];
    public List<EliminatedSummary> EliminatedThisRound { get; set; } = [];
    public bool MatchWillFinish { get; set; }
}

public sealed class RoomSettings
{
    public string Difficulty { get; set; } = "all";
    public int QuestionCount { get; set; } = 10;
    public string Category { get; set; } = "all";
    public string GameMode { get; set; } = "elimination";

    public RoomSettings Clone() => new()
    {
        Difficulty = Difficulty,
        QuestionCount = QuestionCount,
        Category = Category,
        GameMode = GameMode
    };
}

public sealed class PublicRoomSummary
{
    public string Code { get; set; } = "";
    public string HostName { get; set; } = "";
    public int PlayerCount { get; set; }
    public string Phase { get; set; } = "waiting";
    public string Difficulty { get; set; } = "all";
    public int QuestionCount { get; set; }
    public string GameMode { get; set; } = "elimination";
}

public sealed class ClientRoomSnapshot
{
    public string Code { get; set; } = "";
    public string Phase { get; set; } = "waiting";
    public RoomSettings Settings { get; set; } = new();
    public List<PlayerInfo> Players { get; set; } = [];
    public int CurrentQuestionIndex { get; set; }
    public int TotalQuestions { get; set; }
    public long? QuestionEndsAt { get; set; }
    public int TotalQuestionTime { get; set; }
    public long? PhaseEndsAt { get; set; }
    public long ServerNow { get; set; }
    public long? RemainingMs { get; set; }
    public PublicQuestionPayload? CurrentQuestion { get; set; }
    public RoomRevealPayload? Reveal { get; set; }
    public int AnsweredCount { get; set; }
    public int ActiveCount { get; set; }
    public int ConnectedCount { get; set; }
}

public sealed class ClientMessage
{
    public string Type { get; set; } = "";
    public string? PlayerName { get; set; }
    public string? Avatar { get; set; }
    public string? Color { get; set; }
    public string? Code { get; set; }
    public string? PlayerId { get; set; }
    public bool? IsReady { get; set; }
    public RoomSettings? Settings { get; set; }
    public int? OptionIndex { get; set; }
    public string? Emoji { get; set; }
}

public sealed class ServerMessage
{
    public string Type { get; set; } = "";
    public string? PlayerId { get; set; }
    public string? PlayerName { get; set; }
    public string? Emoji { get; set; }
    public string? Message { get; set; }
    public ClientRoomSnapshot? Room { get; set; }
    public List<PublicRoomSummary>? Rooms { get; set; }
}

public sealed class HealthResponse
{
    public bool Ok { get; set; }
    public string Runtime { get; set; } = "dotnet-10";
    public int ActiveRooms { get; set; }
    public int QuestionCount { get; set; }
}

public sealed class RoomsListResponse
{
    public List<PublicRoomSummary> Rooms { get; set; } = [];
}

public sealed class ServerInfoResponse
{
    public int Port { get; set; }
    public int? HttpsPort { get; set; }
    public List<string> LanUrls { get; set; } = [];
    public List<string> HttpsLanUrls { get; set; } = [];
}

[JsonSourceGenerationOptions(
    PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase,
    PropertyNameCaseInsensitive = true)]
[JsonSerializable(typeof(List<QuizQuestion>))]
[JsonSerializable(typeof(ClientMessage))]
[JsonSerializable(typeof(ServerMessage))]
[JsonSerializable(typeof(HealthResponse))]
[JsonSerializable(typeof(RoomsListResponse))]
[JsonSerializable(typeof(ServerInfoResponse))]
internal partial class AppJsonContext : JsonSerializerContext
{
}
