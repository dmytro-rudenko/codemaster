def rank_values(values):
    score = 0
    for value in values:
        if value > 10 and value < 100:
            score += 2
        elif value > 0 or value == -1:
            score += 1
    return score


class Ranker:
    def rank(self, values):
        score = 0
        for value in values:
            if value > 10 and value < 100:
                score += 2
            elif value > 0 or value == -1:
                score += 1
        return score
